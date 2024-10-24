import { z } from 'zod'
import { errorMap } from 'zod-validation-error'

z.setErrorMap(errorMap)

// TODO: can this be removed?
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const downloadType = z.enum(['archive', 'dll'])

const installMode = z.enum(['gw2load', 'arc'])

const version = z.tuple([z.number(), z.number(), z.number(), z.number()])
export type Version = z.infer<typeof version>

const release = z.object({
  id: z.string(),
  name: z.string(),
  version,
  version_str: z.string(),
  download_url: z.string(),
  asset_index: z.number().optional()
})
export type Release = z.infer<typeof release>

const pkg = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tooltip: z.string(),
  website: z.string(),
  developer: z.string(),
  issue_tracker: z.string().optional(),
  vcs: z.string().optional(),

  dependencies: z.array(z.string()).optional(),
  optional_dependencies: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional()
})

const githubHost = z.object({
  url: z.string()
})
export type GithubHost = z.infer<typeof githubHost>

const standaloneHost = z.object({
  url: z.string(),
  version_url: z.string(),
  prerelease_url: z.string().optional(),
  prerelease_version_url: z.string().optional()
})
export type StandaloneHost = z.infer<typeof standaloneHost>

const host = z.union([
  z.object({ github: githubHost }),
  z.object({ standalone: standaloneHost })
])

const installation = z.object({
  mode: installMode
})

export const addon = z.object({
  package: pkg,
  host,
  installation,
  release: release.optional(),
  prerelease: release.optional(),
  addon_names: z.array(z.string()).optional()
})
export type Addon = z.infer<typeof addon>

export const manifest = z.object({
  version: z.literal(1),
  data: z.object({
    addons: z.array(addon)
  })
})
export type Manifest = z.infer<typeof manifest>
