import { PeFileParser } from 'pe-toolkit'
import { unzipSync } from 'fflate'
import { tmpdir } from 'os'
import path from 'node:path'
import * as fs from 'node:fs'
import { exec } from 'child_process'

export enum DownloadType {
  Archive = 'archive',
  Dll = 'dll'
}

export enum InstallMode {
  Gw2Load = 'gw2load',
  Arc = 'arc'
}

export type Version = [number, number, number, number]

export type Release = {
  id: string
  name: string
  version: Version
  version_str: string
  download_url: string
  asset_index?: number
}

export type Package = {
  id: string
  name: string
  description: string
  tooltip: string
  website: string
  developer: string
  issue_tracker?: string
  vcs?: string

  dependencies?: string[]
  optional_dependencies?: string[]
  conflicts?: string[]
}

// export enum HostType {
//   Github = 'github',
//   Standalone = 'standalone'
// }
// export type HostType = 'github' | 'standalone'

export interface GithubHost {
  url: string
}

export interface StandaloneHost {
  url: string
  version_url: string
  prerelease_url?: string
  prerelease_version_url: string
}

type Host = { github: GithubHost } | { standalone: StandaloneHost }

export type Installation = {
  mode: InstallMode
}

export type Plugin = {
  package: Package

  host: Host

  installation: Installation

  release?: Release
  prerelease?: Release
  addon_names?: string[]
}

export function isGreater(a: Version, b: Version): boolean {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i]
    }
  }
  return false
}

export async function createReleaseFromArchive(
  plugin: Plugin,
  fileBuffer: ArrayBuffer,
  id: string,
  downloadUrl: string
): Promise<Release | undefined> {
  const unzipped = unzipSync(new Uint8Array(fileBuffer))
  const files = Object.keys(unzipped)
    .filter(value => value.endsWith('.dll'))
    .map(value => new File([unzipped[value]], value))

  for (const file of files) {
    // save file to tmp
    const filePath = await saveToTmp(file)

    // check if dll has exports, skip if not
    if (!checkDllExports(filePath)) {
      continue
    }

    // create release
    const subFileBuffer = await file.arrayBuffer()
    return createReleaseFromDll(plugin, subFileBuffer, id, downloadUrl)
  }

  return undefined
}

async function saveToTmp(file: File): Promise<string> {
  let dir = tmpdir()
  dir = path.resolve(dir, file.name)
  const buffer = await file.arrayBuffer()
  fs.writeFileSync(dir, new DataView(buffer))
  return dir
}

function checkDllExports(filepath: string): boolean {
  let result = false
  exec(
    `./winedump -j export ${filepath} | grep -e "get_init_addr" -e "GW2Load_GetAddonAPIVersion"`,
    error => {
      result = error !== undefined
    }
  )
  return result
}

export function createReleaseFromDll(
  plugin: Plugin,
  fileBuffer: ArrayBuffer,
  id: string,
  downloadUrl: string
): Release {
  const fileParser = new PeFileParser()

  fileParser.parseBytes(fileBuffer)
  const versionInfoResource = fileParser.getVersionInfoResources()
  if (versionInfoResource === undefined) {
    throw new Error(
      `No versionInfoResource found for plugin ${plugin.package.name}`
    )
  }

  const vsInfoSub = Object.values(versionInfoResource)[0]
  if (vsInfoSub === undefined) {
    throw new Error(`no vsInfoSub found for plugin ${plugin.package.name}`)
  }

  const versionInfo = Object.values(vsInfoSub)[0]
  if (versionInfo === undefined) {
    throw new Error(`No versionInfo found for ${plugin.package.name}`)
  }

  const fixedFileInfo = versionInfo.getFixedFileInfo()
  if (fixedFileInfo === undefined) {
    throw new Error(`No fileInfo found for ${plugin.package.name}`)
  }

  let addonVersion: Version = [
    (fixedFileInfo.getStruct().dwFileVersionMS >> 16) & 0xffff,
    fixedFileInfo.getStruct().dwFileVersionMS & 0xffff,
    (fixedFileInfo.getStruct().dwFileVersionLS >> 16) & 0xffff,
    fixedFileInfo.getStruct().dwFileVersionLS & 0xffff
  ]
  if (addonVersion.every(value => value === 0)) {
    addonVersion = [
      (fixedFileInfo.getStruct().dwProductVersionMS >> 16) & 0xffff,
      fixedFileInfo.getStruct().dwProductVersionMS & 0xffff,
      (fixedFileInfo.getStruct().dwProductVersionLS >> 16) & 0xffff,
      fixedFileInfo.getStruct().dwProductVersionLS & 0xffff
    ]
  }
  if (addonVersion.every(value => value === 0)) {
    throw new Error(`no addonVersion found for plugin ${plugin.package.name}`)
  }

  // read version string
  // console.log(versionInfo)
  let addonVersionStr = undefined
  let addonName = undefined
  const stringFileInfo = versionInfo.getStringFileInfo()
  if (stringFileInfo === undefined) {
    throw new Error(`No StringFileInfo found for plugin ${plugin.package.name}`)
  } else {
    const stringInfo = Object.values(
      stringFileInfo.getStringTables()
    )[0].toObject()

    addonVersionStr =
      stringInfo['FileVersion'] ??
      stringInfo['ProductVersion'] ??
      addonVersion.join('.')

    // read name
    addonName = stringInfo['ProductName'] ?? stringInfo['FileDescription']
    if (addonName === undefined) {
      throw new Error(`No addonName found for plugin ${plugin.package.name}`)
    }
  }

  // this has to be last, so we don't override valid stuff with invalid
  const release: Release = {
    id,
    name: addonName,
    version: addonVersion,
    version_str: addonVersionStr,
    download_url: downloadUrl
  }
  return release
}
