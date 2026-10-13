import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { CATEGORY_LABELS, describeRate } from "@/lib/labels";
import { IS_MOCK } from "@/lib/mode";
import { formatBRL } from "@/lib/money/units";
import type { ReceiptView } from "@/lib/services/receipts";
import { verifyUrl, type MonthlyReport } from "@/lib/services/reports";
import { NETWORK_LABEL, explorerTxUrl } from "@/lib/solana/cluster";

/**
 * PDF documents, rendered on the server with @react-pdf/renderer. They use the
 * built-in Helvetica font, so nothing is downloaded at render time; that font
 * only covers Latin-1, hence "-" and "|" instead of fancier punctuation.
 */
// Never hyphenate: a signature broken with an added "-" is no longer the signature.
Font.registerHyphenationCallback((word) => [word]);

/** Breaks a long hash or signature into lines of `width` characters. */
function wrapMono(text: string, width = 64): string {
  return text.match(new RegExp(`.{1,${width}}`, "g"))?.join("\n") ?? text;
}

const INK = "#14171a";
const MUTED = "#63696e";
const LINE = "#e2dfd8";
const ACCENT = "#0b6b4d";
const DANGER = "#b3261e";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontSize: 9, fontFamily: "Helvetica", color: INK },
  brand: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 12, marginTop: 2, color: MUTED },
  meta: { marginTop: 10, color: MUTED },
  metaLine: { marginTop: 3 },
  mock: { marginTop: 10, padding: 6, color: DANGER, borderWidth: 1, borderColor: DANGER },
  heading: { marginTop: 22, marginBottom: 6, fontSize: 11, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 },
  head: { color: MUTED, fontSize: 8 },
  right: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  block: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: LINE, flexDirection: "row" },
  blockBody: { flex: 1, paddingRight: 12 },
  amount: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  field: { flexDirection: "row", marginTop: 3 },
  fieldLabel: { width: 82, color: MUTED },
  fieldValue: { flex: 1 },
  mono: { fontFamily: "Courier", fontSize: 7.5 },
  link: { color: ACCENT, textDecoration: "none" },
  qr: { width: 92, height: 92 },
  qrCaption: { width: 92, marginTop: 3, fontSize: 7, color: MUTED, textAlign: "center" },
  sealed: { color: ACCENT, fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 28,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: LINE,
    fontSize: 8,
    color: MUTED,
  },
});

function absolute(url: string, appUrl: string): string {
  return url.startsWith("/") ? `${appUrl}${url}` : url;
}

function Header({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View>
      <Text style={styles.brand}>Yvex Chain</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.meta}>
        {lines.map((line) => (
          <Text key={line} style={styles.metaLine}>
            {line}
          </Text>
        ))}
      </View>
      {IS_MOCK && (
        <Text style={styles.mock}>
          MOCK MODE. This document was generated from simulated data. Nothing in it is onchain.
        </Text>
      )}
    </View>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) => `${text}   |   Page ${pageNumber} of ${totalPages}`}
    />
  );
}

/** The company behind the account, when there is one. Declared by the company, not verified. */
export type PdfCompany = { name: string; tax_id: string | null } | null;

function companyLines(company: PdfCompany): string[] {
  if (!company) return [];
  return [company.tax_id ? `Company: ${company.name}   |   Tax ID: ${company.tax_id}` : `Company: ${company.name}`];
}

function SummaryDocument({
  report,
  wallet,
  company,
}: {
  report: MonthlyReport;
  wallet: string;
  company: PdfCompany;
}) {
  return (
    <Document title={`Yvex Chain summary ${report.month}`} author="Yvex Chain">
      <Page size="A4" style={styles.page}>
        <Header
          title={`Monthly summary, ${report.month}`}
          lines={[
            ...companyLines(company),
            `Wallet: ${wallet}`,
            `Network: ${NETWORK_LABEL}`,
            "Dates in Brasilia time (BRT).",
          ]}
        />

        <Text style={styles.heading}>Totals by category</Text>
        <View style={[styles.row, styles.head]}>
          <Text style={{ flex: 2 }}>Category</Text>
          <Text style={[{ flex: 1 }, styles.right]}>Payments</Text>
          <Text style={[{ flex: 2 }, styles.right]}>Amount</Text>
          <Text style={[{ flex: 2 }, styles.right]}>Value in BRL</Text>
        </View>
        {report.totals.map((total) => (
          <View key={`${total.category}-${total.symbol}`} style={styles.row}>
            <Text style={{ flex: 2 }}>{CATEGORY_LABELS[total.category]}</Text>
            <Text style={[{ flex: 1 }, styles.right]}>{total.count}</Text>
            <Text style={[{ flex: 2 }, styles.right]}>
              {total.amount} {total.symbol}
            </Text>
            <Text style={[{ flex: 2 }, styles.right]}>{formatBRL(total.amount_brl)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={[{ flex: 5 }, styles.bold]}>All incoming payments</Text>
          <Text style={[{ flex: 2 }, styles.right, styles.bold]}>{formatBRL(report.total_brl)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={{ flex: 5 }}>Excluding transfers between own wallets</Text>
          <Text style={[{ flex: 2 }, styles.right]}>{formatBRL(report.total_brl_excluding_own)}</Text>
        </View>

        <Text style={styles.heading}>Payments</Text>
        <View style={[styles.row, styles.head]}>
          <Text style={{ flex: 2 }}>Date (BRT)</Text>
          <Text style={{ flex: 3 }}>Counterparty</Text>
          <Text style={{ flex: 2 }}>Category</Text>
          <Text style={[{ flex: 2 }, styles.right]}>Amount</Text>
          <Text style={[{ flex: 2 }, styles.right]}>Value in BRL</Text>
          <Text style={[{ flex: 1 }, styles.right]}>Sealed</Text>
        </View>
        {report.receipts.map((receipt) => (
          <View key={receipt.id} style={styles.row} wrap={false}>
            <Text style={{ flex: 2 }}>{receipt.block_time_brt}</Text>
            <Text style={{ flex: 3 }}>{receipt.contact?.name ?? "-"}</Text>
            <Text style={{ flex: 2 }}>{CATEGORY_LABELS[receipt.category ?? "unclassified"]}</Text>
            <Text style={[{ flex: 2 }, styles.right]}>
              {receipt.amount} {receipt.symbol}
            </Text>
            <Text style={[{ flex: 2 }, styles.right]}>
              {receipt.amount_brl ? formatBRL(receipt.amount_brl) : "-"}
            </Text>
            <Text style={[{ flex: 1 }, styles.right]}>{receipt.seal_signature ? "Yes" : "No"}</Text>
          </View>
        ))}
        {report.receipts.length === 0 && <Text style={styles.meta}>No payments in this month.</Text>}

        <Footer text="Informational records only. Not tax advice." />
      </Page>
    </Document>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValue}>{children}</View>
    </View>
  );
}

function DossierBlock({ receipt, qr, appUrl }: { receipt: ReceiptView; qr: string | null; appUrl: string }) {
  const paymentUrl = absolute(explorerTxUrl(receipt.tx_signature), appUrl);
  return (
    <View style={styles.block} wrap={false}>
      <View style={styles.blockBody}>
        <Text style={styles.amount}>
          {receipt.amount} {receipt.symbol}
          {receipt.amount_brl ? `   =   ${formatBRL(receipt.amount_brl)}` : ""}
        </Text>
        {receipt.fx && <Text style={{ marginTop: 2, color: MUTED }}>{describeRate(receipt.fx)}</Text>}

        <Field label="Received">
          <Text>{receipt.block_time_brt} (Brasilia time)</Text>
        </Field>
        <Field label="Category">
          <Text>{CATEGORY_LABELS[receipt.category ?? "unclassified"]}</Text>
        </Field>
        <Field label="Counterparty">
          <Text>
            {receipt.contact ? `${receipt.contact.name} (declared by the recipient)` : "Not named"}
          </Text>
        </Field>
        {receipt.description && (
          <Field label="Description">
            <Text>{receipt.description}</Text>
          </Field>
        )}
        {receipt.invoice_number && (
          <Field label="Invoice">
            <Text>{receipt.invoice_number}</Text>
          </Field>
        )}
        <Field label="Payer wallet">
          <Text style={styles.mono}>{receipt.payer_wallet ?? "-"}</Text>
        </Field>
        <Field label="Payment tx">
          <Link src={paymentUrl} style={[styles.mono, styles.link]}>
            {wrapMono(receipt.tx_signature)}
          </Link>
        </Field>
        {receipt.seal_signature ? (
          <>
            <Field label="Receipt hash">
              <Text style={styles.mono}>{receipt.receipt_hash}</Text>
            </Field>
            <Field label="Seal tx">
              <Link
                src={absolute(explorerTxUrl(receipt.seal_signature), appUrl)}
                style={[styles.mono, styles.link]}
              >
                {wrapMono(receipt.seal_signature)}
              </Link>
            </Field>
            <Field label="Verify">
              <Link src={verifyUrl(receipt.id, appUrl)} style={styles.link}>
                {verifyUrl(receipt.id, appUrl)}
              </Link>
            </Field>
          </>
        ) : (
          <Field label="Seal">
            <Text>Not sealed. This payment has no verifiable receipt yet.</Text>
          </Field>
        )}
      </View>
      {qr && (
        <View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an HTML <img>: it has no alt prop */}
          <Image src={qr} style={styles.qr} />
          <Text style={styles.qrCaption}>Scan to verify</Text>
        </View>
      )}
    </View>
  );
}

export async function renderSummaryPdf(
  report: MonthlyReport,
  wallet: string,
  company: PdfCompany = null,
): Promise<Buffer> {
  return renderToBuffer(<SummaryDocument report={report} wallet={wallet} company={company} />);
}

/**
 * "Proof of origin": one block per receipt with its onchain references and,
 * for sealed receipts, a QR code that opens the public verification page.
 */
export async function renderDossierPdf(
  receipts: ReceiptView[],
  wallet: string,
  appUrl: string,
  company: PdfCompany = null,
): Promise<Buffer> {
  const qrCodes = await Promise.all(
    receipts.map((receipt) =>
      receipt.seal_signature
        ? QRCode.toDataURL(verifyUrl(receipt.id, appUrl), { margin: 0, width: 240 })
        : null,
    ),
  );
  return renderToBuffer(
    <Document title="Yvex Chain proof of origin" author="Yvex Chain">
      <Page size="A4" style={styles.page}>
        <Header
          title="Proof of origin"
          lines={[
            ...companyLines(company),
            `Recipient wallet: ${wallet}`,
            `Network: ${NETWORK_LABEL}`,
            "Each sealed receipt below can be checked by anyone, without trusting Yvex Chain:",
            "the page recomputes the receipt hash and reads both transactions from the chain.",
          ]}
        />
        {receipts.map((receipt, index) => (
          <DossierBlock key={receipt.id} receipt={receipt} qr={qrCodes[index]} appUrl={appUrl} />
        ))}
        <Footer text="Informational records only. Not tax advice. Counterparty identity is declared by the recipient." />
      </Page>
    </Document>,
  );
}
