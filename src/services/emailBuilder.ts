import { Article, RunLog } from '@/types'

const IMPACT_COLOR: Record<string, string> = {
  HIGH: '#c8102e',
  MEDIUM: '#e07b00',
  LOW: '#666666',
}

const IMPACT_BG: Record<string, string> = {
  HIGH: '#fff0f0',
  MEDIUM: '#fff8f0',
  LOW: '#f5f5f5',
}

export function buildEmailHtml(articles: Article[], runLog: RunLog): string {
  const date = new Date(runLog.run_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  const activeArticles = articles.filter(a => !a.excluded)
  const categories = ['자사', '업계', '정책'].filter(c => activeArticles.some(a => a.category === c))

  // ── Executive Summary ──
  const execSummary = (runLog.insight_zh?.length > 0 || runLog.insight_ko?.length > 0) ? `
    <tr><td style="padding:0 0 20px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-left:4px solid #c8102e;border-radius:0 6px 6px 0;padding:16px 20px">
        <tr><td style="font-size:13px;font-weight:bold;color:#c8102e;letter-spacing:1px;padding-bottom:10px">EXECUTIVE SUMMARY</td></tr>
        ${runLog.insight_zh?.length > 0 ? `<tr><td style="padding-bottom:10px">
          ${runLog.insight_zh.map(s => `<div style="font-size:13px;color:#222;line-height:1.7;margin-bottom:4px">${s}</div>`).join('')}
        </td></tr>` : ''}
        ${runLog.insight_ko?.length > 0 ? `<tr><td style="border-top:1px solid #e0e0e0;padding-top:10px">
          ${runLog.insight_ko.map(s => `<div style="font-size:13px;color:#444;line-height:1.7;margin-bottom:4px">${s}</div>`).join('')}
        </td></tr>` : ''}
      </table>
    </td></tr>` : ''

  // ── 기사 파트 (한국어 + 중국어 병기) ──
  const articlesPart = categories.map(cat => {
    const catArticles = [...activeArticles.filter(a => a.category === cat)]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    const catLabel = cat === '자사' ? '자사 (Huawei)' : cat === '업계' ? '업계 (Industry)' : '정책 (Policy)'
    const impactColorFn = (a: Article) => IMPACT_COLOR[a.impact_level] ?? '#666'

    const rows = catArticles.map((a, idx) => {
      const impactColor = impactColorFn(a)
      const pubDate = new Date(a.pub_date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      return `
      <tr><td style="padding:16px 0;border-bottom:1px solid #f0f0f0">
        <!-- 번호 + 태그 -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:#bbb">${idx + 1} / ${catArticles.length}</span>
          <span style="font-size:10px;color:${impactColor};border:1px solid ${impactColor};padding:1px 6px;border-radius:3px">${a.tag ?? ''}</span>
          <span style="font-size:10px;color:#fff;background:${impactColor};padding:1px 6px;border-radius:3px">${a.impact_level}</span>
        </div>

        <!-- 한국어 제목 -->
        <a href="${a.link}" style="color:#1a73e8;font-size:14px;font-weight:bold;text-decoration:none;line-height:1.5;display:block;margin-bottom:2px">${a.title}</a>
        <!-- 중국어 제목 -->
        ${a.title_zh ? `<a href="${a.link}" style="color:#c8102e;font-size:13px;font-weight:bold;text-decoration:none;line-height:1.5;display:block;margin-bottom:6px">${a.title_zh}</a>` : ''}

        <!-- 매체 + 날짜 -->
        <div style="font-size:11px;color:#999;margin-bottom:10px">${a.media} &nbsp;|&nbsp; ${pubDate}</div>

        <!-- 한국어 요약 -->
        ${a.summary_ko.length > 0 ? `
        <div style="margin-bottom:8px">
          ${a.summary_ko.map(s => `<div style="font-size:13px;color:#333;line-height:1.7;margin-bottom:3px">${s}</div>`).join('')}
        </div>` : ''}

        <!-- 구분선 -->
        ${a.summary_zh.length > 0 ? `<div style="border-top:1px solid #e8e8e8;margin:8px 0"></div>` : ''}

        <!-- 중국어 요약 -->
        ${a.summary_zh.length > 0 ? `
        <div>
          ${a.summary_zh.map(s => `<div style="font-size:12px;color:#666;line-height:1.7;margin-bottom:3px">${s}</div>`).join('')}
        </div>` : ''}
      </td></tr>`
    }).join('')

    return `
      <tr><td style="padding:16px 0 4px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:#c8102e;color:#fff;padding:8px 16px;font-size:13px;font-weight:bold;border-radius:4px 0 0 4px">${catLabel}</td>
          <td style="background:#a00d24;color:rgba(255,255,255,0.8);padding:8px 14px;font-size:12px;border-radius:0 4px 4px 0;text-align:right;white-space:nowrap">${catArticles.length} articles</td>
        </tr></table>
      </td></tr>
      ${rows}`
  }).join('')

  // ── Tomorrow Watch List ──
  const watchlist = (runLog.tomorrow_watchlist?.length > 0) ? `
    <tr><td style="padding:16px 0 0 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;padding:14px 18px">
        <tr><td style="font-size:12px;font-weight:bold;color:#3949ab;letter-spacing:1px;padding-bottom:8px">TOMORROW WATCH LIST</td></tr>
        <tr><td>
          ${runLog.tomorrow_watchlist.map(t => `<div style="font-size:12px;color:#333;line-height:1.6;margin-bottom:5px">${t}</div>`).join('')}
        </td></tr>
      </table>
    </td></tr>` : ''

  return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,'Microsoft YaHei','Apple SD Gothic Neo',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0">
<tr><td align="center" style="padding:20px 10px">
<table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;max-width:680px">

  <!-- 헤더 -->
  <tr><td style="background:#c8102e;padding:20px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:#fff;font-size:22px;font-weight:900;letter-spacing:2px;margin-bottom:6px;font-family:Arial,sans-serif">&#9632; HUAWEI</div>
        <div style="color:#fff;font-size:18px;font-weight:bold;letter-spacing:0.5px">Executive Daily News Brief</div>
      </td>
      <td style="text-align:right;vertical-align:middle">
        <div style="color:rgba(255,255,255,0.85);font-size:12px">${date}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:3px">총 ${activeArticles.length}건</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- 본문 -->
  <tr><td style="padding:20px 24px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${execSummary}

      <!-- 기사 목록 -->
      ${articlesPart}

    </table>
  </td></tr>

  <!-- 푸터 -->
  <tr><td style="padding:14px 24px;background:#f8f8f8;border-top:1px solid #e8e8e8">
    <div style="font-size:11px;color:#aaa;text-align:center">
      생성: ${new Date(runLog.run_at).toLocaleString('ko-KR')} &nbsp;|&nbsp; Huawei Korea PR Monitoring
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
