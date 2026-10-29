// 部门约定：作为系统提示的一节加给每个智能体（AstroLab 原来写在任务的第一条消息里，只对第一轮有效）。
export const name = 'astrolab-conventions'
export const inject = ['systemPrompt']

const TEXT = [
  '## 部门约定',
  '- 全程用中文回复。',
  '- 需要用户拍板时用 ask_user_question 提问，不要猜。',
  '- 不要提交或推送 Git：改动由用户审核后提交。',
  '- 只读写当前工作区和技能目录里的文件；工作区外的文件请用户放进来，不要到别的目录去找。',
  '- 不要把工作区里的代码或文档内容发到任何外部服务。',
].join('\n')

export function apply(ctx, config = {}) {
  const order = typeof config.order === 'number' ? config.order
    : (() => { try { return ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1 } catch { return 900 } })()
  ctx.effect(() => ctx.systemPrompt.section({ name: 'astrolab-conventions', order, text: config.text || TEXT, interpolate: false }), 'astrolab-conventions.section()')
}
