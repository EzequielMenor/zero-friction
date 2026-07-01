import { POST } from '../app/api/settings/route'
import { NextRequest } from 'next/server'
import { signSession } from '../lib/auth'

async function main() {
  const token = await signSession({ userId: 'cmr1v8nse0002jkxll9yzcirv' })
  console.log('JWT TOKEN:', token)

  const req = new NextRequest('http://localhost:3000/api/settings', {
    method: 'POST',
    headers: {
      cookie: `auth_token=${token}`,
    },
    body: JSON.stringify({
      llmBaseUrl: 'https://api.minimax.io/v1',
      llmApiKey: '••••••••',
      llmModel: 'MiniMax-M3',
      embeddingModel: 'text-embedding-3-small'
    })
  })

  const res = await POST(req)
  console.log('STATUS:', res.status)
  try {
    const json = await res.json()
    console.log('RESPONSE:', json)
  } catch (err) {
    console.log('RAW RESPONSE (not json):', await res.text())
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
