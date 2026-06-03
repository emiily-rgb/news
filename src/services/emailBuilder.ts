import { Article, RunLog } from '@/types'

const IMPACT_COLOR: Record<string, string> = {
  HIGH: '#c8102e',
  MEDIUM: '#e07b00',
  LOW: '#999999',
}

function bulletItem(s: string, color = '#444', fontSize = 14) {
  const text = s.startsWith('•') ? s.slice(1).trim() : s
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px"><tr><td width="14" valign="top" style="font-size:${fontSize}px;color:#111;line-height:1.7;padding-right:4px">•</td><td style="font-size:${fontSize}px;color:${color};line-height:1.7">${text}</td></tr></table>`
}

function renderInsightItems(items: string[], color: string, subtitleKo: string, subtitleZh: string, isZh: boolean) {
  const normalItems = items.filter(s => !s.startsWith('•'))
  const bulletItems = items.filter(s => s.startsWith('•'))
  return `
    ${normalItems.map(s => `<div style="font-size:14px;color:${color};line-height:1.8;margin-bottom:6px">${s}</div>`).join('')}
    ${bulletItems.length > 0 ? `
      <div style="font-size:11px;font-weight:600;color:#c8102e;letter-spacing:1px;margin-top:12px;margin-bottom:6px;text-transform:uppercase">${isZh ? subtitleZh : subtitleKo}</div>
      ${bulletItems.map(s => bulletItem(s, color)).join('')}
    ` : ''}
  `
}

function formatDateEn(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function buildEmailHtml(articles: Article[], runLog: RunLog): string {
  const date = new Date(runLog.run_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  const activeArticles = articles.filter(a => !a.excluded)
  const categories = ['위기이슈', '자사', '업계', '정책'].filter(c => activeArticles.some(a => a.category === c))

  // ── Executive Summary ──
  const execSummary = (runLog.insight_zh?.length > 0 || runLog.insight_ko?.length > 0) ? `
    <tr><td style="padding:0 0 24px 0">
      ${runLog.insight_zh?.length > 0 ? `
      <div style="font-size:15px;font-weight:700;color:#c8102e;letter-spacing:0.3px;margin-bottom:10px">今日焦点新闻</div>
      <div style="padding:16px 20px;border:1px solid #f0f0f0;border-radius:4px;margin-bottom:16px">
        ${renderInsightItems(runLog.insight_zh, '#333', 'Key Takeaways', '核心要点', true)}
      </div>` : ''}
      ${runLog.insight_ko?.length > 0 ? `
      <div style="font-size:15px;font-weight:700;color:#c8102e;letter-spacing:0.3px;margin-bottom:10px">오늘의 하이라이트</div>
      <div style="padding:16px 20px;border:1px solid #f0f0f0;border-radius:4px">
        ${renderInsightItems(runLog.insight_ko, '#333', 'Key Takeaways', '核心要点', false)}
      </div>` : ''}
    </td></tr>` : ''

  function catLabel(cat: string) {
    return cat === '자사' ? 'Huawei' : cat === '업계' ? 'Industry' : cat === '정책' ? 'Policy' : 'Crisis'
  }
  function catLabelZh(cat: string) {
    return cat === '자사' ? '华为动态' : cat === '업계' ? '行业资讯' : cat === '정책' ? '政策动向' : '危机事项'
  }

  function articleRows(catArticles: Article[], titleField: 'zh' | 'ko') {
    return catArticles.map(a => {
      const impactColor = IMPACT_COLOR[a.impact_level] ?? '#999'
      const pubDate = formatDateEn(a.pub_date)
      const title = titleField === 'zh'
        ? (a.title_zh || a.title)
        : a.title
      const summary = titleField === 'zh' ? a.summary_zh : a.summary_ko
      return `
      <tr><td style="padding:14px 0;border-bottom:1px solid #f5f5f5">
        <div style="margin-bottom:7px">
          <span style="font-size:11px;font-weight:600;color:${impactColor};border:1px solid ${impactColor};padding:2px 7px;border-radius:2px;margin-right:6px;letter-spacing:0.3px">${a.impact_level}</span>
          ${a.tag ? `<span style="font-size:11px;color:#999;border:1px solid #e0e0e0;padding:2px 7px;border-radius:2px;letter-spacing:0.3px">${a.tag}</span>` : ''}
        </div>
        <a href="${a.link}" style="color:#111;font-size:15px;font-weight:600;text-decoration:none;line-height:1.5;display:block;margin-bottom:4px">${title}</a>
        <div style="font-size:12px;color:#bbb;margin-bottom:8px">${a.media} &nbsp;·&nbsp; ${pubDate}</div>
        ${summary.length > 0 ? `<div>${summary.map(s => bulletItem(s)).join('')}</div>` : ''}
      </td></tr>`
    }).join('')
  }

  // ── 중문 섹션 ──
  const zhPart = categories.map(cat => {
    const catArticles = [...activeArticles.filter(a => a.category === cat)]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    return `
      <tr><td style="padding:20px 0 4px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-left:3px solid #c8102e;padding-left:10px;font-size:16px;font-weight:700;color:#111;letter-spacing:0.3px">${catLabelZh(cat)}</td>
          <td style="text-align:right;font-size:12px;color:#bbb">${catArticles.length} articles</td>
        </tr></table>
      </td></tr>
      ${articleRows(catArticles, 'zh')}`
  }).join('')

  // ── 국문 섹션 ──
  const koPart = categories.map(cat => {
    const catArticles = [...activeArticles.filter(a => a.category === cat)]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    return `
      <tr><td style="padding:20px 0 4px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-left:3px solid #c8102e;padding-left:10px;font-size:16px;font-weight:700;color:#111;letter-spacing:0.3px">${catLabel(cat)}</td>
          <td style="text-align:right;font-size:12px;color:#bbb">${catArticles.length} articles</td>
        </tr></table>
      </td></tr>
      ${articleRows(catArticles, 'ko')}`
  }).join('')

  // ── 섹션 구분선 ──
  const sectionDivider = `
    <tr><td style="padding:24px 0 8px 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="border-top:1px solid #ebebeb"></td>
      </tr></table>
      <div style="font-size:12px;color:#ccc;text-align:center;padding-top:10px;letter-spacing:0.5px">▼ 한국어 Korean</div>
    </td></tr>`

  return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Apple SD Gothic Neo','Microsoft YaHei',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4">
<tr><td align="center" style="padding:24px 10px">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;max-width:640px;box-shadow:0 1px 4px rgba(0,0,0,0.08)">

  <!-- 헤더 -->
  <tr><td style="padding:24px 28px;border-bottom:2px solid #c8102e">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">
        <img src="https://news-ebon-alpha.vercel.app/huawei_logo.png" alt="HUAWEI" height="28" style="display:inline-block;vertical-align:middle;margin-right:10px" />
        <span style="color:#bbb;font-size:14px;font-weight:400;margin-left:10px;vertical-align:middle">Daily News Brief</span>
      </td>
      <td style="text-align:right;vertical-align:middle">
        <div style="color:#555;font-size:12px">${date}</div>
        <div style="color:#bbb;font-size:12px;margin-top:2px">${activeArticles.length} articles</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- 본문 -->
  <tr><td style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${execSummary}

      <!-- 중문 섹션 -->
      ${zhPart}

      <!-- 구분선 -->
      ${sectionDivider}

      <!-- 국문 섹션 -->
      ${koPart}

    </table>
  </td></tr>

  <!-- 푸터 -->
  <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0f0f0">
    <div style="font-size:12px;color:#ccc;text-align:center">
      ${new Date(runLog.run_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} &nbsp;·&nbsp; Huawei Korea
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

export function buildMailtoLink(html: string, recipients: string[], subject: string): string {
  const to = recipients.join(',')
  const body = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 1800)
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
