import { guard } from '../http'
import { pair } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, pair)
