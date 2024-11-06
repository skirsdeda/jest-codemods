/* eslint-env jest */
import chalk from 'chalk'

import { wrapPlugin } from '../utils/test-helpers'
import plugin from './mockery'

chalk.level = 0

const wrappedPlugin = wrapPlugin(plugin)

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation().mockClear()
})

interface TransformationOptions {
  warnings?: string[]
  parser?: string
}

function expectTransformation(
  source,
  expectedOutput,
  options: TransformationOptions = {}
) {
  const { warnings = [], parser } = options

  const result = wrappedPlugin(source, { parser })
  expect(result).toBe(expectedOutput)
  expect(console.warn).toHaveBeenCalledTimes(warnings.length)
  warnings.forEach((warning, i) => {
    expect(console.warn).toHaveBeenNthCalledWith(i + 1, warning)
  })
}

test('mockery => jest basic', () => {
  expectTransformation(
    `
    const smth = require('smth')
    const mockery = require('mockery')

    describe('Some module test', () => {
        let subject

        const someStub = jest.fn()

        beforeEach(() => {
            mockery.enable({ useCleanCache: true, warnOnUnregistered: false })

            const someModuleMock = {
                ...require('../../../../src/lib/services/some-module'),
                someFunc: someStub,
            };

            mockery.registerMock('non-relative-mod', {})
            mockery.registerMock('../../lib/services/some-module', someModuleMock)

            subject = require('../../../../src/handlers/api/do-something')
        });

        afterAll(() => {
            mockery.deregisterAll()
            mockery.disable()
        })
    })
`,
    `
    const smth = require('smth')

    describe('Some module test', () => {
        let subject

        const someStub = jest.fn()

        beforeEach(() => {
            const someModuleMock = {
                ...jest.requireActual('../../../../src/lib/services/some-module'),
                someFunc: someStub,
            };

            jest.mock('non-relative-mod', () => ({}))
            jest.mock('../../../../src/lib/services/some-module', () => someModuleMock)

            subject = require('../../../../src/handlers/api/do-something')
        });

        afterAll(() => {})
    })
`
  )
})
