import { guard } from '../http'
import { webhook } from '../handlers/webhook'
import { getDeps } from '../wire'

export const handler = guard(getDeps, webhook)
