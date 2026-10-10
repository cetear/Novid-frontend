import { describe, expect, it, vi } from 'vitest'
vi.mock('@/shared/ui/StatusBadge.vue', () => ({
  default: { props: ['status'], template: '<span>{{ status }}</span>' },
}))
import { mount } from '@vue/test-utils'
import RunGraph from '@/features/runs/components/RunGraph.vue'
import { timelineGroups } from '@/features/runs/model'
import { graphSchema } from '@/shared/api/contracts/backend'
import { graph } from '../stageFixtures'

describe('run node details', () => {
  it('groups workflow categories and span types while preserving unknown and zero durations', () => {
    const node = graph.nodes[0]!
    const groups = timelineGroups([
      { ...node, spanId: 'read-later', type: 'AGENT', name: 'read_slice2', sequence: 4 },
      {
        ...node,
        spanId: 'pending',
        type: 'AGENT',
        name: 'read_slice3',
        sequence: 5,
        endedAt: null,
      },
      { ...node, spanId: 'read-first', type: 'AGENT', name: 'read_slice1', sequence: 1 },
      { ...node, spanId: 'zero', type: 'ZERO', sequence: 2, endedAt: node.startedAt },
      { ...node, spanId: 'invalid', type: 'UNKNOWN', sequence: 3, endedAt: 'invalid' },
      { ...node, spanId: 'extract', type: 'AGENT', name: 'extract_slice1_0_50', sequence: 6 },
      { ...node, spanId: 'intent', type: 'AGENT', name: 'intent', sequence: 7 },
      { ...node, spanId: 'custom', type: 'READ', sequence: 8 },
    ])
    expect(groups.map((group) => group.category)).toEqual([
      'read',
      'ZERO',
      'UNKNOWN',
      'extract',
      'intent',
      'READ',
    ])
    expect(groups[0]).toMatchObject({ totalDuration: 4000, unknownCount: 1 })
    expect(groups[0]?.nodes.map((node) => node.spanId)).toEqual([
      'read-first',
      'read-later',
      'pending',
    ])
    expect(groups[1]).toMatchObject({ totalDuration: 0, unknownCount: 0 })
    expect(groups[2]).toMatchObject({ totalDuration: null, unknownCount: 1 })
    expect(timelineGroups([])).toEqual([])
  })
  it('starts collapsed and expands only the selected category with node detail access', async () => {
    const value = structuredClone(graph)
    value.nodes.push(
      { ...value.nodes[2]!, spanId: 'read-a', type: 'AGENT', name: 'read_slice1', sequence: 4 },
      { ...value.nodes[2]!, spanId: 'read-b', type: 'AGENT', name: 'read_slice2', sequence: 5 },
      {
        ...value.nodes[2]!,
        spanId: 'read-pending',
        type: 'AGENT',
        name: 'read_slice3',
        sequence: 6,
        endedAt: null,
      },
    )
    const wrapper = mount(RunGraph, {
      props: { graph: value },
      global: {
        stubs: {
          ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
        },
      },
    })
    expect(wrapper.find('.run-node-tree').exists()).toBe(false)
    expect(wrapper.find('.timeline-row').exists()).toBe(false)
    const category = wrapper.findAll('.timeline-group-toggle')[3]!
    expect(category.text()).toContain('read')
    expect(category.text()).toContain('3 个节点')
    expect(category.text()).toContain('已知耗时 4000 ms')
    expect(category.text()).toContain('1 个耗时未知')
    expect(category.attributes('aria-expanded')).toBe('false')
    await category.trigger('click')
    expect(category.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.timeline-row')).toHaveLength(3)
    expect(wrapper.findAll('.timeline-node-duration').map((row) => row.text())).toEqual([
      '2000 ms',
      '2000 ms',
      '未知',
    ])
    await wrapper.get('.timeline-row .node-link').trigger('click')
    expect(wrapper.get('[aria-label="节点详情"]').text()).toContain('read_slice1')
    await category.trigger('click')
    expect(wrapper.find('.timeline-row').exists()).toBe(false)
    wrapper.unmount()
  })
  it('preserves new payloads and accepts historical nodes without payloads', () => {
    expect(graphSchema.parse(graph).nodes[0]?.input).toBeUndefined()
    const value = structuredClone(graph)
    value.nodes[1]!.input = {
      content: '{"prompt":"question"}',
      truncated: false,
      originalChars: 21,
    }
    expect(graphSchema.parse(value).nodes[1]?.input?.content).toContain('question')
  })
  it('opens input, output and elapsed time from a graph node with keyboard controls', async () => {
    const value = structuredClone(graph)
    value.nodes[1]!.input = {
      content: '<img src=x onerror=alert(1)>',
      truncated: false,
      originalChars: 26,
    }
    value.nodes[1]!.output = { content: '回答片段', truncated: true, originalChars: 20000 }
    const wrapper = mount(RunGraph, {
      props: { graph: value },
      global: {
        stubs: {
          ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
        },
      },
    })
    await wrapper.findAll('g[role="button"]')[1]!.trigger('keydown', { key: 'Enter' })
    const panel = wrapper.get('[aria-label="节点详情"]')
    expect(panel.text()).toContain('耗时')
    expect(panel.text()).toContain('2000 ms')
    expect(panel.get('[aria-label="节点输入"] pre').text()).toContain('<img')
    expect(panel.find('img').exists()).toBe(false)
    expect(panel.get('[aria-label="节点输出"]').text()).toContain('已截断')
    expect(wrapper.findAll('g[role="button"]')[1]!.attributes('aria-pressed')).toBe('true')
    await wrapper.findAll('g[role="button"]')[0]!.trigger('keydown', { key: ' ' })
    expect(wrapper.get('[aria-label="节点详情"]').text()).toContain('未记录内容')
    wrapper.unmount()
  })
  it('keeps metadata visible when source permissions hide content', async () => {
    const value = structuredClone(graph)
    value.nodes[1]!.payloadSources = [{ knowledgeBaseId: 1, documentId: 2, documentVersion: 1 }]
    const wrapper = mount(RunGraph, {
      props: { graph: value },
      global: {
        stubs: {
          ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
        },
      },
    })
    await wrapper.findAll('g[role="button"]')[1]!.trigger('click')
    expect(wrapper.get('[aria-label="节点详情"]').text()).toContain('内容已隐藏')
    expect(wrapper.get('[aria-label="节点详情"]').text()).toContain('2000 ms')
    wrapper.unmount()
  })
})
