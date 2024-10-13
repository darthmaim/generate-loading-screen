import { PeFileParser } from 'pe-toolkit'
import { unzipSync } from 'fflate'
import { tmpdir } from 'os'
import path from 'node:path'
import * as fs from 'node:fs'
import { exec } from 'child_process'
import { Plugin, Release, Version } from './schema'

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
  let filePath = tmpdir()
  filePath = path.resolve(filePath, file.name)

  // enforce folder is there
  const dirPath = path.dirname(filePath)
  fs.mkdirSync(dirPath, { recursive: true })

  const buffer = await file.arrayBuffer()
  fs.writeFileSync(filePath, new DataView(buffer))
  return filePath
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
