import { sendReminder } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = (event: { id?: string }) => sendReminder(getDeps(), event)
