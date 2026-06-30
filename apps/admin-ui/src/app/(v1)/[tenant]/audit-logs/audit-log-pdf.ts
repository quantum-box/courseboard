type AuditLogSummaryItem = {
	actorId: string
	resourceType: string
	resourceId: string
	action: string
	createdAt: string
}

export function summarizeAuditLogs(items: AuditLogSummaryItem[]) {
	const actionCounts = new Map<string, number>()
	for (const item of items) {
		actionCounts.set(item.action, (actionCounts.get(item.action) ?? 0) + 1)
	}
	const summary = Array.from(actionCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([action, count]) => `${action}: ${count}`)

	const recent = items.slice(0, 40).map(item =>
		`${item.createdAt} ${item.actorId} ${item.action} ${item.resourceType}:${item.resourceId}`,
	)
	return ['Action counts', ...summary, '', 'Recent events', ...recent]
}

export function buildSimplePdf(lines: string[]) {
	const escaped = lines
		.slice(0, 120)
		.map(line => line.replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&'))
	const content = [
		'BT',
		'/F1 10 Tf',
		'50 790 Td',
		...escaped.flatMap((line, index) => [
			index === 0 ? '' : '0 -14 Td',
			`(${line}) Tj`,
		]),
		'ET',
	]
		.filter(Boolean)
		.join('\n')
	const objects = [
		'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
		'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
		'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
		'4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
		`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
	]
	let pdf = '%PDF-1.4\n'
	const offsets = [0]
	for (const object of objects) {
		offsets.push(pdf.length)
		pdf += object
	}
	const xrefOffset = pdf.length
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
	return pdf
}
