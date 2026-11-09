// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PortList from './PortList.vue'
import DiskListItem from './DiskListItem.vue'
import DiskDetail from './DiskDetail.vue'
import { emptyHistory } from '../history'
import { diskRow, GB } from '../testing/fixtures'
import type { DiskReport } from '../../../shared/types'

function report(over: Partial<DiskReport> = {}): DiskReport {
  return { rows: [], scannedAt: 1, scanning: false, error: null, ...over }
}

function list(disk: DiskReport | null): ReturnType<typeof mount> {
  return mount(PortList, {
    props: {
      ports: [],
      agents: [],
      leftovers: [],
      history: emptyHistory(),
      selectedKey: null,
      hook: null,
      disk
    }
  })
}

describe('디스크 정리 묶음', () => {
  test('아직 안 찾음·찾는 중·없음·오류를 구분해 알린다', () => {
    expect(list(null).get('.disk-empty').text()).toBe(
      '아직 찾지 않았어요. 앱을 켜고 1분 뒤에 찾아요.'
    )
    expect(
      list(report({ scannedAt: null, scanning: true }))
        .get('.disk-empty')
        .text()
    ).toBe('찾는 중…')
    expect(list(report()).get('.disk-empty').text()).toBe('정리할 끝난 워크트리가 없어요.')
    expect(
      list(report({ error: 'git 을 찾지 못해' }))
        .get('.disk-empty')
        .text()
    ).toBe('git 을 찾지 못해')
  })

  test('다시 찾기 버튼(찾는 중이면 막음), 행을 누르면 디스크 선택 키', async () => {
    const w = list(report({ rows: [diskRow()] }))
    await w.get('.btn-disk-scan').trigger('click')
    expect(w.emitted('diskScan')).toHaveLength(1)
    await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
    expect(w.emitted('select')).toEqual([['disk:C:\\work\\old-feature']])
    const scanning = list(report({ scanning: true, rows: [diskRow()] }))
    expect(scanning.get('.btn-disk-scan').attributes('disabled')).toBeDefined()
    expect(scanning.get('.btn-disk-scan').text()).toBe('찾는 중…')
  })

  test('검색은 경로·브랜치에도 걸린다', async () => {
    const w = list(
      report({ rows: [diskRow(), diskRow({ worktreeRoot: 'C:\\work\\other', branch: 'fix/x' })] })
    )
    await w.get('.search-input').setValue('fix/')
    expect(w.findAll('.monitor-list .item:not(.group-item)')).toHaveLength(1)
  })
})

describe('DiskListItem', () => {
  test('알약은 크기(재는 중이면 그렇게), 이름은 폴더, 태그는 근거·브랜치·사용 중', () => {
    const w = mount(DiskListItem, { props: { row: diskRow(), active: false } })
    expect(w.get('.badge').text()).toBe('1.5 GB')
    expect(w.get('.badge').classes()).toContain('bg-warning')
    expect(w.get('.name').text()).toBe('old-feature')
    expect(w.findAll('.tag-text').map((t) => t.text())).toEqual(['원격 삭제됨', 'feat/old'])
    const busy = mount(DiskListItem, {
      props: { row: diskRow({ totalBytes: null, inUse: true, evidence: 'merged' }), active: false }
    })
    expect(busy.get('.badge').text()).toBe('재는 중…')
    expect(busy.get('.badge').classes()).toContain('bg-secondary')
    expect(busy.findAll('.tag-text').map((t) => t.text())).toEqual([
      '머지됨',
      'feat/old',
      '사용 중'
    ])
  })
})

describe('DiskDetail', () => {
  test('제목·경로·근거 설명·크기 칸·폴더 표, 지우기 버튼', async () => {
    const w = mount(DiskDetail, { props: { row: diskRow(), busy: false, notice: null } })
    expect(w.get('h1').text()).toBe('old-feature')
    expect(w.get('.url').text()).toBe('C:\\work\\old-feature')
    expect(w.get('.note').text()).toContain('원격 브랜치가 지워졌어요')
    expect(w.findAll('.stats .col')[0].text()).toContain('1.5 GB')
    expect(w.get('.folders tbody').text()).toContain('C:\\work\\old-feature\\node_modules')
    await w.get('.btn-remove').trigger('click')
    expect(w.emitted('remove')).toHaveLength(1)
  })

  test('사용 중·재는 중·처리 중·지울 폴더 없음(링크뿐)이면 지우기 버튼을 막는다', () => {
    const disabled = (row: ReturnType<typeof diskRow>, busy = false): boolean =>
      mount(DiskDetail, { props: { row, busy, notice: null } })
        .get('.btn-remove')
        .attributes('disabled') !== undefined
    expect(disabled(diskRow({ inUse: true }))).toBe(true)
    expect(
      disabled(
        diskRow({ folders: [{ name: 'node_modules', path: 'C:\\x\\node_modules', bytes: null }] })
      )
    ).toBe(true)
    expect(disabled(diskRow(), true)).toBe(true)
    expect(
      disabled(
        diskRow({
          folders: [
            { name: 'node_modules', path: 'C:\\x\\node_modules', bytes: null, skipped: 'link' }
          ],
          totalBytes: 0
        })
      )
    ).toBe(true)
    expect(disabled(diskRow())).toBe(false)
    const inUse = mount(DiskDetail, {
      props: { row: diskRow({ inUse: true }), busy: false, notice: null }
    })
    expect(inUse.get('.note').text()).toContain('실행 중이라 지울 수 없어요')
  })

  test('링크 폴더는 건너뛴다고 보인다', () => {
    const w = mount(DiskDetail, {
      props: {
        row: diskRow({
          folders: [
            { name: 'node_modules', path: 'C:\\x\\node_modules', bytes: 2 * GB },
            { name: '.venv', path: 'C:\\x\\.venv', bytes: null, skipped: 'link' }
          ]
        }),
        busy: false,
        notice: null
      }
    })
    expect(w.get('.folders tbody').text()).toContain('링크라 건너뜀')
  })
})

describe('남은 프로세스 색', () => {
  test('에이전트 워크트리의 남은 프로세스는 회색 알약, 그것뿐이면 묶음 알약도 회색', async () => {
    const { default: LeftoverListItem } = await import('./LeftoverListItem.vue')
    const { leftoverRow } = await import('../testing/fixtures')
    const item = mount(LeftoverListItem, {
      props: { row: leftoverRow({ agentInWorktree: true }), active: false }
    })
    expect(item.get('.badge').classes()).toContain('bg-secondary')
    const w = mount(PortList, {
      props: {
        ports: [],
        agents: [],
        leftovers: [leftoverRow({ agentInWorktree: true })],
        history: emptyHistory(),
        selectedKey: null,
        hook: null,
        disk: null
      }
    })
    const pills = w.findAll('.group-item .badge')
    expect(pills[2].classes()).toContain('bg-secondary')
  })
})
