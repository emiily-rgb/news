export async function register() {
  // 서버사이드에서만 실행
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = (await import('node-cron')).default

    // 매일 오전 6시 자동 수집
    cron.schedule('0 6 * * *', async () => {
      console.log('[스케줄러] 오전 6시 자동 뉴스 수집 시작')
      try {
        const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/run`, {
          method: 'POST',
          headers: { 'x-cron-secret': process.env.CRON_SECRET ?? 'huawei-cron' },
        })
        const data = await res.json()
        console.log('[스케줄러] 수집 시작됨. runId:', data.runId)
      } catch (err) {
        console.error('[스케줄러] 자동 수집 실패:', err)
      }
    }, {
      timezone: 'Asia/Seoul',
    })

    console.log('[스케줄러] 매일 오전 6시 자동 수집 등록 완료 (Asia/Seoul)')
  }
}
