/*
 * What this build is.
 *
 * Vite replaces these two identifiers textually at build time. `typeof` on an
 * undeclared name is legal JavaScript and does not throw, so the same module
 * imports cleanly under `node --test`, where neither define exists and the
 * fallbacks below apply. That matters: the flag tests run in node, and a
 * module that only works inside a bundle could not be tested there.
 */

/* global __APP_VERSION__, __APP_COMMIT__ */

import { channelOf } from './flags.js'

export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'

export const COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'

/** alpha | beta | rc | stable, decided by the version and nothing else. */
export const CHANNEL = channelOf(VERSION)

/** How a build names itself on screen: "0.2.0-alpha.1 (a1b2c3d)". */
export const buildLabel = () => (COMMIT === 'dev' ? VERSION : `${VERSION} (${COMMIT})`)
