import { guard } from '../http'
import { ack } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, ack)
