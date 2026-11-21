import { guard } from '../http'
import { outbox } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, outbox)
