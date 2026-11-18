export async function downloadPdf(url, filename) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Gagal mengunduh dokumen (${response.status}).`)
  }
  if (!(response.headers.get('content-type') || '').includes('application/pdf')) {
    throw new Error('Dokumen yang diterima bukan berkas PDF.')
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}
