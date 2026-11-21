import { guard } from '../http'
import { deleteReminder } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, deleteReminder)
