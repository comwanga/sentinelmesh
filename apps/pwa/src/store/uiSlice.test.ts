import uiReducer, { setOverlayIntent, consumeOverlayIntent } from './uiSlice'

const initial = { uiIntent: { type: 'overlay' as const, name: null } }

describe('uiSlice', () => {
  it('has null intent as initial state', () => {
    expect(uiReducer(undefined, { type: '' })).toEqual(initial)
  })

  it('sets routes overlay intent', () => {
    const state = uiReducer(undefined, setOverlayIntent({ name: 'routes' }))
    expect(state.uiIntent).toEqual({ type: 'overlay', name: 'routes' })
  })

  it('sets acoustic overlay intent', () => {
    const state = uiReducer(undefined, setOverlayIntent({ name: 'acoustic' }))
    expect(state.uiIntent).toEqual({ type: 'overlay', name: 'acoustic' })
  })

  it('clears intent on consumeOverlayIntent', () => {
    const loaded = uiReducer(undefined, setOverlayIntent({ name: 'routes' }))
    const cleared = uiReducer(loaded, consumeOverlayIntent())
    expect(cleared.uiIntent.name).toBeNull()
  })
})
