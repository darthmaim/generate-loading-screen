import * as core from '@actions/core'
import { addon as addonSchema, Addon } from './schema'
import { updateFromGithub } from './github'
import { updateStandalone } from './standalone'
import * as fs from 'node:fs'
import * as toml from 'toml'
import path from 'node:path'
import { isZodErrorLike } from 'zod-validation-error'

export function addAddonName(addon: Addon, name: string): void {
  if (addon.addon_names === undefined) {
    addon.addon_names = [name]
  } else {
    if (!addon.addon_names.includes(name)) {
      addon.addon_names = addon.addon_names.concat(name)
    }
  }
}

async function update(addon: Addon): Promise<void> {
  if ('github' in addon.host) {
    await updateFromGithub(addon, addon.host.github)
  } else if ('standalone' in addon.host) {
    await updateStandalone(addon, addon.host.standalone)
  }
}

/** The main function for the action. */
export async function run(): Promise<void> {
  try {
    // get addons path (defaults to `addons`)
    const addonsPathInput = core.getInput('addons_path', { required: true })
    const addonsPath = path.resolve(addonsPathInput)

    // get manifest path
    const manifestPathInput = core.getInput('manifest_path')
    const manifestPath =
      manifestPathInput !== '' ? path.resolve(manifestPathInput) : undefined

    await generateManifest({ addonsPath, manifestPath })
  } catch (error) {
    // Fail the workflow run if an error occurs
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.log(errorMessage)
    core.setFailed(errorMessage)
  }
}

export async function generateManifest({
  addonsPath,
  manifestPath
}: {
  addonsPath: string
  manifestPath: string | undefined
}): Promise<void> {
  // make sure addons directory exists
  if (!fs.existsSync(addonsPath)) {
    throw new Error(`Addon directory does not exist: ${addonsPath}`)
  }

  // manifest path should either be undefined to output to STDOUT
  // or a path to a file, but never empty
  if (manifestPath === '') {
    throw new Error(
      'Invalid manifest path. Set to undefined to output to STDOUT.'
    )
  }

  // list of addons
  const addons: Addon[] = []

  // flag if a validation error was encountered while reading addon configs
  let encounteredValidationError = false

  // collect addons from addon directory
  for (const fileName of fs.readdirSync(addonsPath)) {
    const filePath = path.join(addonsPath, fileName)
    const tomlContent = fs.readFileSync(filePath)

    try {
      const config = addonSchema.parse(toml.parse(tomlContent.toString()))
      addons.push(config)
    } catch (error) {
      if (isZodErrorLike(error)) {
        // flag that we encountered a validation error so we can fail later
        // we don't instantly fail so we can validate all addons first
        encounteredValidationError = true

        for (const validationError of error.errors) {
          core.error(validationError.message, { file: filePath })
          console.error(`${fileName}: ${validationError.message}`)
        }
      } else {
        // if this was not just a validation error, rethrow the error
        throw error
      }
    }
  }

  // if any addon failed validation, we don't continue
  if (encounteredValidationError) {
    throw Error('Validation of some addons failed')
  }

  // check if manifest already exists, then merge addon definitions
  if (manifestPath && fs.existsSync(manifestPath)) {
    const existingManifest: Addon[] = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    )

    for (const existingAddon of existingManifest) {
      const found = addons.find(
        value => value.package.id === existingAddon.package.id
      )
      if (!found) {
        core.warning(
          `Addon ${existingAddon.package.id} was removed from manifest!`
        )
        continue
      }

      found.release = existingAddon.release
      found.prerelease = existingAddon.prerelease
      found.addon_names = existingAddon.addon_names
    }
  }

  // update addons
  for (const addon of addons) {
    try {
      await update(addon)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const message = `Addon ${addon.package.name} failed to update: ${errorMessage}`
      core.error(message)
      console.log(message)
    }
  }

  const manifest = {
    addons
  }

  // output manifest
  if (manifestPath) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  } else {
    console.log(JSON.stringify(manifest, null, 2))
  }
}
