import { Component, type ReactNode } from 'react'

// If the robot model fails to load, show the fallback (the box) instead of breaking the 3D view.
const logged = new Set<string>()

interface Props {
  url: string
  fallback: ReactNode
  children: ReactNode
}

export class ModelErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err: unknown) {
    // Every robot has its own boundary; log once per URL, not once per robot.
    if (logged.has(this.props.url)) return
    logged.add(this.props.url)
    console.error(`[Yard3D] Failed to load robot model ${this.props.url}; showing box fallback.`, err)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
