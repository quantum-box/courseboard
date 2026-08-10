import * as React from 'react'
import { i18next } from '../i18n'

// native-ui currently ships TSX compiled with the classic JSX runtime while
// importing React as a type only. Browser bundles already provide the expected
// transform; expose React explicitly in Vitest so its real components can be
// exercised instead of replacing the Sheet with a test double.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

// Tests assert Japanese copy, so pin the locale instead of inheriting the host
// machine's `navigator.language`.
void i18next.changeLanguage('ja')
