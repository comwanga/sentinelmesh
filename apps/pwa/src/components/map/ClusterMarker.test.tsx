import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ClusterMarker } from './ClusterMarker'

const baseProps = {
  clusterId: 'c1',
  criticalCount: 2,
  highCount: 3,
  mediumCount: 1,
  lowCount: 0,
  totalCount: 6,
}

describe('ClusterMarker', () => {
  it('renders an SVG element', () => {
    const { container } = render(<ClusterMarker {...baseProps} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses 18px outer radius for count 5-14', () => {
    const { container } = render(<ClusterMarker {...baseProps} totalCount={6} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('36') // 18 * 2
  })

  it('uses 14px outer radius for count 1-4', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={3} criticalCount={2} highCount={1} mediumCount={0} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('28') // 14 * 2
  })

  it('uses 22px outer radius for count 15-49', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={20} criticalCount={10} highCount={5} mediumCount={5} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('44') // 22 * 2
  })

  it('uses 26px outer radius for count 50-199', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={100} criticalCount={50} highCount={30} mediumCount={20} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('52') // 26 * 2
  })

  it('uses 30px outer radius for count 200+', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={250} criticalCount={100} highCount={100} mediumCount={50} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('60') // 30 * 2
  })

  it('renders count label in text element', () => {
    const { container } = render(<ClusterMarker {...baseProps} totalCount={6} />)
    const text = container.querySelector('text')!
    expect(text.textContent).toBe('6')
  })

  it('renders 99+ for counts over 99', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={150} criticalCount={100} highCount={50} mediumCount={0} lowCount={0} />
    )
    const text = container.querySelector('text')!
    expect(text.textContent).toBe('99+')
  })

  it('calls onClick when wrapper div is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<ClusterMarker {...baseProps} onClick={onClick} />)
    const wrapper = container.firstElementChild as HTMLElement
    wrapper.click()
    expect(onClick).toHaveBeenCalled()
  })

  it('renders CRITICAL arc circle when criticalCount > 0', () => {
    const { container } = render(<ClusterMarker {...baseProps} criticalCount={2} />)
    const circles = container.querySelectorAll('circle')
    const criticalCircle = Array.from(circles).find(c => c.getAttribute('stroke') === '#FF2D2D')
    expect(criticalCircle).toBeDefined()
  })

  it('does not render CRITICAL arc when criticalCount is 0', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} criticalCount={0} totalCount={3} highCount={2} mediumCount={1} lowCount={0} />
    )
    const circles = container.querySelectorAll('circle')
    const criticalCircle = Array.from(circles).find(c => c.getAttribute('stroke') === '#FF2D2D')
    expect(criticalCircle).toBeUndefined()
  })
})
