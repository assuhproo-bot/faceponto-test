import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';

export type AttendanceReportRow = {
  date: string;
  employee: string;
  registration: string;
  plannedMinutes: number;
  workedMinutes: number | null;
  balanceMinutes: number | null;
  overtimeMinutes: number | null;
  missingMinutes: number | null;
  state: string;
};

export type AttendanceReport = {
  companyName: string;
  timezone: string;
  generatedAt: Date;
  from: string | undefined;
  to: string | undefined;
  rows: AttendanceReportRow[];
};

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const columnName = (index: number) => String.fromCharCode(65 + index);
const minutes = (value: number | null) => {
  if (value == null) return '-';
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
};
const period = (report: AttendanceReport) => report.from || report.to ? `${report.from ?? 'inicio'} a ${report.to ?? 'hoje'}` : 'Todo o periodo';
const total = (report: AttendanceReport, field: 'plannedMinutes' | 'workedMinutes' | 'balanceMinutes' | 'overtimeMinutes' | 'missingMinutes') =>
  report.rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);

function cells(values: string[], row: number, style = 0) {
  return values.map((value, index) => `<c r="${columnName(index)}${row}" t="inlineStr" s="${style}"><is><t>${xmlEscape(value)}</t></is></c>`).join('');
}

export function attendanceXlsx(report: AttendanceReport): Buffer {
  const header = ['Data', 'Matricula', 'Colaborador', 'Previsto', 'Trabalhado', 'Extra', 'Falta', 'Saldo', 'Estado'];
  const detail = report.rows.map((row) => [row.date, row.registration, row.employee, minutes(row.plannedMinutes), minutes(row.workedMinutes), minutes(row.overtimeMinutes), minutes(row.missingMinutes), minutes(row.balanceMinutes), row.state]);
  const summary = ['TOTAL', '', '', minutes(total(report, 'plannedMinutes')), minutes(total(report, 'workedMinutes')), minutes(total(report, 'overtimeMinutes')), minutes(total(report, 'missingMinutes')), minutes(total(report, 'balanceMinutes')), ''];
  const sheetRows = [
    `<row r="1">${cells([`FacePonto - Relatorio de jornadas - ${report.companyName}`], 1, 2)}</row>`,
    `<row r="2">${cells([`Periodo: ${period(report)} | Fuso: ${report.timezone}`], 2)}</row>`,
    `<row r="3">${cells([`Gerado em: ${report.generatedAt.toISOString()}`], 3)}</row>`,
    `<row r="5">${cells(header, 5, 1)}</row>`,
    ...detail.map((row, index) => `<row r="${index + 6}">${cells(row, index + 6)}</row>`),
    `<row r="${detail.length + 7}">${cells(summary, detail.length + 7, 1)}</row>`,
  ].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="8" width="14" customWidth="1"/><col min="9" max="9" width="16" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Jornadas" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }, { level: 6 }));
}

export function attendancePdf(report: AttendanceReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Pontíficeluga - Relatório de jornadas' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.font('Helvetica-Bold').fontSize(16).text('Pontíficeluga - Relatório de jornadas');
    document.font('Helvetica').fontSize(9).fillColor('#334155').text(report.companyName);
    document.text(`Periodo: ${period(report)} | Fuso: ${report.timezone}`);
    document.text(`Gerado em: ${report.generatedAt.toISOString()}`);
    document.moveDown().fillColor('#000000');
    document.font('Helvetica-Bold').fontSize(9).text(`Previsto ${minutes(total(report, 'plannedMinutes'))}   Trabalhado ${minutes(total(report, 'workedMinutes'))}   Extra ${minutes(total(report, 'overtimeMinutes'))}   Falta ${minutes(total(report, 'missingMinutes'))}   Saldo ${minutes(total(report, 'balanceMinutes'))}`);
    document.moveDown().font('Courier-Bold').fontSize(7).text('DATA        MATRICULA       COLABORADOR                PREV.  TRAB.  EXTRA  FALTA  SALDO  ESTADO');
    document.font('Courier').fontSize(7);
    for (const row of report.rows) {
      if (document.y > 780) { document.addPage(); document.font('Courier-Bold').text('DATA        MATRICULA       COLABORADOR                PREV.  TRAB.  EXTRA  FALTA  SALDO  ESTADO'); document.font('Courier'); }
      const line = `${row.date.padEnd(11)} ${row.registration.slice(0, 14).padEnd(14)} ${row.employee.slice(0, 25).padEnd(25)} ${minutes(row.plannedMinutes).padStart(6)} ${minutes(row.workedMinutes).padStart(6)} ${minutes(row.overtimeMinutes).padStart(6)} ${minutes(row.missingMinutes).padStart(6)} ${minutes(row.balanceMinutes).padStart(6)}  ${row.state.slice(0, 12)}`;
      document.text(line);
    }
    if (!report.rows.length) document.font('Helvetica-Oblique').text('Nenhuma jornada encontrada para este filtro.');
    document.end();
  });
}
