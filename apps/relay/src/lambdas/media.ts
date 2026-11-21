import { guard } from '../http'
import { media } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, media)
