import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cw from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as ddb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as scheduler from 'aws-cdk-lib/aws-scheduler'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import type { Construct } from 'constructs'

export interface RelayStackProps extends cdk.StackProps {
  /** Quem recebe os alarmes. Sem isso, o tópico é criado sem assinante. */
  alertEmail?: string
}

/** Prefixo dos parâmetros no SSM. Os SecureString são criados por `pnpm relay:set-secret`, nunca pelo CDK. */
export const SSM_PREFIX = '/pingo'
export const SCHEDULER_GROUP = 'pingo'

const SRC = path.join(import.meta.dirname, '..', 'src', 'lambdas')

export class RelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RelayStackProps) {
    super(scope, id, props)
    cdk.Tags.of(this).add('app', 'pingo')

    // Dados transitórios: recriáveis com um comando. Nada aqui é a "fonte da verdade" do dono.
    const removal = cdk.RemovalPolicy.DESTROY

    // ------------------------------------------------------------------ dados
    const table = new ddb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: removal,
    })

    const inboxDlq = new sqs.Queue(this, 'InboxDlq', {
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
    })
    const inboxQueue = new sqs.Queue(this, 'InboxQueue', {
      fifo: true,
      // Texto das mensagens fica só aqui, por até 4 dias, e some no ack (design.md §5).
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: inboxDlq, maxReceiveCount: 5 },
      removalPolicy: removal,
    })
    // Lembretes que o Scheduler não conseguiu entregar depois das tentativas.
    const reminderFailures = new sqs.Queue(this, 'ReminderFailures', {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
    })

    const bucket = new s3.Bucket(this, 'Media', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(1),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: removal,
      autoDeleteObjects: true,
    })

    new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', { name: SCHEDULER_GROUP })

    // ---------------------------------------------------------------- Lambdas
    const base = {
      TABLE_NAME: table.tableName,
      QUEUE_URL: inboxQueue.queueUrl,
      BUCKET_NAME: bucket.bucketName,
      SSM_PREFIX,
      SCHEDULER_GROUP,
      SCHEDULER_DLQ_ARN: reminderFailures.queueArn,
      ...(process.env.GRAPH_API_VERSION
        ? { GRAPH_API_VERSION: process.env.GRAPH_API_VERSION }
        : {}),
    }

    const makeFn = (
      name: string,
      entry: string,
      opts: { timeout?: number; env?: Record<string, string> } = {},
    ) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: removal,
      })
      return new nodejs.NodejsFunction(this, name, {
        entry: path.join(SRC, `${entry}.ts`),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: cdk.Duration.seconds(opts.timeout ?? 10),
        logGroup,
        environment: { ...base, ...(opts.env ?? {}) },
        bundling: {
          minify: true,
          target: 'node22',
          // O SDK vai junto: versão fixa e igual ao que foi testado, sem depender do que o runtime traz.
          externalModules: [],
          sourceMap: false,
        },
      })
    }

    const sendReminder = makeFn('SendReminder', 'send-reminder', { timeout: 20 })

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    })
    sendReminder.grantInvoke(schedulerRole)
    reminderFailures.grantSendMessages(schedulerRole)

    const reminderEnv = {
      SEND_REMINDER_ARN: sendReminder.functionArn,
      SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
    }

    const webhook = makeFn('Webhook', 'webhook')
    const pair = makeFn('Pair', 'pair')
    const inbox = makeFn('Inbox', 'inbox', { timeout: 28 })
    const ack = makeFn('Ack', 'ack')
    const outbox = makeFn('Outbox', 'outbox', { timeout: 15 })
    const media = makeFn('MediaFn', 'media', { timeout: 25 })
    const allowlist = makeFn('Allowlist', 'allowlist')
    const reminderPut = makeFn('ReminderPut', 'reminder-put', { env: reminderEnv })
    const reminderDelete = makeFn('ReminderDelete', 'reminder-delete', { env: reminderEnv })
    const me = makeFn('Me', 'me', { timeout: 25, env: reminderEnv })

    // ---------------------------------------------------------- permissões mínimas
    for (const f of [
      webhook,
      pair,
      inbox,
      allowlist,
      reminderPut,
      reminderDelete,
      me,
      sendReminder,
    ]) {
      table.grantReadWriteData(f)
    }
    for (const f of [ack, outbox, media]) table.grantReadData(f)

    inboxQueue.grantSendMessages(webhook)
    inboxQueue.grantConsumeMessages(inbox)
    inboxQueue.grantConsumeMessages(ack)
    inboxQueue.grantPurge(me)

    const metaParams = this.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `${SSM_PREFIX.slice(1)}/meta/*`,
    })
    for (const f of [webhook, outbox, media, sendReminder]) {
      f.addToRolePolicy(
        new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [metaParams] }),
      )
    }

    bucket.grantReadWrite(media)
    bucket.grantRead(me)
    bucket.grantDelete(me)

    const scheduleArns = this.formatArn({
      service: 'scheduler',
      resource: 'schedule',
      resourceName: `${SCHEDULER_GROUP}/*`,
    })
    reminderPut.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule'],
        resources: [scheduleArns],
      }),
    )
    reminderPut.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    )
    for (const f of [reminderDelete, me]) {
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['scheduler:DeleteSchedule'],
          resources: [scheduleArns],
        }),
      )
    }
    // ListSchedules não aceita restrição por agendamento; a lista só é usada dentro do grupo "pingo".
    me.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['scheduler:ListSchedules'], resources: ['*'] }),
    )

    // -------------------------------------------------------------------- API
    const api = new apigw.HttpApi(this, 'Api', { apiName: 'pingo-relay' })
    const routes: apigw.HttpRoute[] = []
    const route = (
      method: apigw.HttpMethod[],
      routePath: string,
      fn: lambda.IFunction,
      name: string,
    ) =>
      routes.push(
        ...api.addRoutes({
          path: routePath,
          methods: method,
          integration: new HttpLambdaIntegration(name, fn),
        }),
      )
    const { GET, POST, PUT, DELETE } = apigw.HttpMethod
    route([GET, POST], '/wa/webhook', webhook, 'WebhookInt')
    route([POST], '/device/pair', pair, 'PairInt')
    route([GET], '/inbox', inbox, 'InboxInt')
    route([POST], '/inbox/ack', ack, 'AckInt')
    route([POST], '/outbox', outbox, 'OutboxInt')
    route([GET], '/media/{id}', media, 'MediaInt')
    route([PUT], '/allowlist', allowlist, 'AllowlistInt')
    route([PUT], '/reminders/{id}', reminderPut, 'ReminderPutInt')
    route([DELETE], '/reminders/{id}', reminderDelete, 'ReminderDeleteInt')
    route([DELETE], '/me', me, 'MeInt')

    // Limites de taxa: uso pessoal não passa disso; abuso esbarra aqui antes de virar custo.
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 }
    // O limite por rota só pode ser criado depois da rota existir.
    for (const r of routes) stage.node.addDependency(r)
    // `routeSettings` é JSON livre no CloudFormation: aqui as chaves são em PascalCase.
    stage.routeSettings = {
      'POST /device/pair': { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
    }

    // ---------------------------------------------------------------- alarmes
    const topic = new sns.Topic(this, 'Alerts', { displayName: 'Pingo: alertas' })
    if (props.alertEmail) topic.addSubscription(new subs.EmailSubscription(props.alertEmail))
    const act = new cwActions.SnsAction(topic)
    const alarm = (name: string, metric: cw.IMetric, description: string, threshold = 1) => {
      const a = new cw.Alarm(this, name, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      })
      a.addAlarmAction(act)
    }
    const fiveMin = cdk.Duration.minutes(5)
    alarm(
      'InboxDlqAlarm',
      inboxDlq.metricApproximateNumberOfMessagesVisible({ period: fiveMin }),
      'Mensagem do WhatsApp que o app não conseguiu processar após várias tentativas.',
    )
    alarm(
      'ReminderFailuresAlarm',
      reminderFailures.metricApproximateNumberOfMessagesVisible({ period: fiveMin }),
      'Lembrete na nuvem que não foi entregue após as tentativas (R11.5).',
    )
    alarm(
      'WebhookErrorsAlarm',
      webhook.metricErrors({ period: fiveMin }),
      'O webhook do WhatsApp deu erro.',
    )
    alarm(
      'SendReminderErrorsAlarm',
      sendReminder.metricErrors({ period: fiveMin }),
      'Falha ao enviar lembrete.',
    )
    alarm(
      'RequestVolumeAlarm',
      new cw.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Count',
        dimensionsMap: { ApiId: api.apiId },
        statistic: 'Sum',
        period: cdk.Duration.hours(1),
      }),
      'Volume incomum de chamadas ao relay (possível abuso ou custo fora do esperado).',
      3000,
    )

    // ------------------------------------------------------------------ saídas
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      description: 'Base da API (webhook da Meta e app)',
    })
    new cdk.CfnOutput(this, 'WebhookUrl', { value: `${api.apiEndpoint}/wa/webhook` })
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName })
    new cdk.CfnOutput(this, 'AlertsTopicArn', { value: topic.topicArn })
  }
}
