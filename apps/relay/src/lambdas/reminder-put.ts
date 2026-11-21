import { guard } from '../http'
import { putReminder } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, putReminder)
