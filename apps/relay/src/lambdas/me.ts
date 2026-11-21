import { guard } from '../http'
import { eraseMe } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, eraseMe)
