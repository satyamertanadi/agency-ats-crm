import '@testing-library/jest-dom/vitest'
import {cleanup,configure} from '@testing-library/react'
import {afterEach,vi} from 'vitest'

// Testing Library only auto-registers cleanup when Vitest globals are enabled, and they are not.
// Without this, renders accumulate in the document and queries match elements from earlier tests.
afterEach(cleanup)

// findBy* defaults to 1s, which a loaded CI machine can miss while jsdom settles a React Query
// render. The tests are still assertion-bound, so a longer ceiling only costs time on real failures.
configure({asyncUtilTimeout:5000})

// jsdom implements no layout, so it ships no scrollIntoView. Components that keep an active option
// in view call it for real in a browser; here it only needs to exist.
if(!Element.prototype.scrollIntoView)Element.prototype.scrollIntoView=vi.fn()
