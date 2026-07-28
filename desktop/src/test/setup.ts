import { i18next } from '../i18n'

// Tests assert Japanese copy, so pin the locale instead of inheriting the host
// machine's `navigator.language`.
void i18next.changeLanguage('ja')
