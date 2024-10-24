/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as main from '../src/main'
import path from 'node:path'

// Mock the GitHub Actions core library
let debugMock: jest.SpiedFunction<typeof core.debug>
let errorMock: jest.SpiedFunction<typeof core.error>
let warningMock: jest.SpiedFunction<typeof core.warning>
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>

describe('action', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    debugMock = jest.spyOn(core, 'debug').mockImplementation()
    errorMock = jest.spyOn(core, 'error').mockImplementation()
    warningMock = jest.spyOn(core, 'warning').mockImplementation()
    getInputMock = jest.spyOn(core, 'getInput')
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
    setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
  })

  it('local test', async () => {
    const manifest = await main.generateManifest({
      addonsPath: path.resolve(__dirname, 'addons'),
      manifestPath: undefined
    })

    expect(manifest.data.addons).toHaveLength(4)
    expect(setFailedMock).not.toHaveBeenCalled()
  }, 20_000)

  it('should merge (legacy array) manifest', async () => {
    const manifest = await main.generateManifest({
      addonsPath: path.resolve(__dirname, 'empty'),
      manifestPath: path.resolve(__dirname, 'manifest-array.json')
    })

    expect(manifest.data.addons).toHaveLength(0)
    expect(warningMock).toHaveBeenCalledWith(
      'Addon gw2radial was removed from manifest!'
    )
    expect(setFailedMock).not.toHaveBeenCalled()
  })

  it('should merge manifest', async () => {
    const manifest = await main.generateManifest({
      addonsPath: path.resolve(__dirname, 'empty'),
      manifestPath: path.resolve(__dirname, 'manifest.json')
    })

    expect(manifest.data.addons).toHaveLength(0)
    expect(warningMock).toHaveBeenCalledWith(
      'Addon gw2radial was removed from manifest!'
    )
    expect(setFailedMock).not.toHaveBeenCalled()
  })

  it('should fail if manifest is invalid', async () => {
    const manifestPromise = main.generateManifest({
      addonsPath: path.resolve(__dirname, 'empty'),
      manifestPath: path.resolve(__dirname, 'invalid.json')
    })

    await expect(manifestPromise).rejects.toHaveProperty(
      'message',
      'Invalid manifest'
    )
  })
})
