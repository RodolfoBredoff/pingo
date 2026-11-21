import { guard } from '../http'
import { allowlist } from '../handlers/device'
import { getDeps } from '../wire'

export const handler = guard(getDeps, allowlist)
