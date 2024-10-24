import * as core from '@actions/core'
import {
  addon as addonSchema,
  Addon,
  manifest as manifestSchema,
  Manifest
} from './schema'
import { updateFromGithub } from './github'
import { updateStandalone } from './standalone'
import * as fs from 'node:fs'
import * as toml from 'toml'
import path from 'node:path'
import { isZodErrorLike } from 'zod-validation-error'
import { z } from 'zod'

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

    const manifest = await generateManifest({ addonsPath, manifestPath })

    if (manifestPath) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    } else {
      console.log(JSON.stringify(manifest, null, 2))
    }
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
}): Promise<Manifest> {
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
    // skip files that don't end with .toml
    if (!fileName.endsWith('.toml')) {
      continue
    }

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
    const existingAddons = await readManifest(manifestPath)

    for (const existingAddon of existingAddons) {
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

  const manifest: Manifest = {
    version: 1,
    data: {
      addons
    }
  }

  return manifest
}

async function readManifest(manifestPath: string): Promise<Addon[]> {
  const manifestJson: unknown = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  )

  // manifest has to be an object (arrays are objects too)
  if (typeof manifestJson !== 'object' || !manifestJson) {
    throw new Error('Invalid manifest')
  }

  if (Array.isArray(manifestJson)) {
    // if the manifest is just an array, try to parse as array of addons
    return z.array(addonSchema).parse(manifestJson)
  }

  if ('version' in manifestJson) {
    // if the manifest has a version, we can parse it
    const manifest = manifestSchema.parse(manifestJson)
    return manifest.data.addons
  }

  // the manifest was neither an array nor had it version set
  throw new Error('Invalid manifest')
}
