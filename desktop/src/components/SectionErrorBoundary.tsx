import { Button } from '@tachyon-sdk/native-ui'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { i18next } from '../i18n'
import { Notice } from './Page'

export class SectionErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('A Course Board section failed to render', error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  private retry = () => this.setState({ failed: false })

  render() {
    if (this.state.failed) {
      return (
        <Notice
          tone="danger"
          title={i18next.t('common:error.sectionUnavailableTitle')}
          actions={(
            <Button type="button" size="sm" onClick={this.retry}>
              {i18next.t('common:action.retry')}
            </Button>
          )}
        >
          {i18next.t('common:error.sectionUnavailableDescription')}
        </Notice>
      )
    }
    return this.props.children
  }
}
