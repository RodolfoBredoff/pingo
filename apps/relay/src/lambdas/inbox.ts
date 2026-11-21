import { guard } from '../http'
import { inbox } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, inbox)
