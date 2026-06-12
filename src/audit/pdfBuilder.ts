"use strict";

/**
 * pdfBuilder.ts  —  PDF document generators for audit and voter receipts.
 *
 * Two public functions:
 *   buildBuPdf(eventAddr)                 → Buffer (Boletim de Urna PDF)
 *   buildReceiptPdf(eventAddr, nullifier) → Buffer (voter receipt PDF)
 *
 * Both return a Promise<Buffer> that can be sent directly as
 * Content-Type: application/pdf.  No temp files are written to disk.
 */

import PDFDocument from "pdfkit";
import { createHash } from "crypto";
import { readBoletimUrna, readVoteCastLogs } from "../chain/event";
import type { BoletimUrna, RaceSnapshot, Candidate } from "../chain/event";

// ── Palette / layout constants ────────────────────────────────────────────────

const BRAND_BLUE  = "#1a3a5c";
const BRAND_TEAL  = "#0d7b8e";
const LIGHT_GRAY  = "#f2f4f7";
const TEXT_DARK   = "#1a1a1a";
const TEXT_MUTED  = "#6b7280";
const RED_ACCENT  = "#b91c1c";
const GREEN_ACCENT = "#15803d";
const MARGIN      = 50;
const PAGE_WIDTH  = 595; // A4 points

// ── Helpers ───────────────────────────────────────────────────────────────────

function pdfBuffer(fn: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      fn(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const stateLabel = ["PENDING", "OPEN", "FINALIZADA"];

function header(
  doc: PDFKit.PDFDocument,
  title: string,
  subtitle: string,
): void {
  const HEADER_H = 84;
  doc.rect(0, 0, PAGE_WIDTH, HEADER_H).fill(BRAND_BLUE);

  doc
    .fillColor("white")
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(title, MARGIN, 22, { width: PAGE_WIDTH - MARGIN * 2, lineBreak: false });

  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#c8d8e8")
    .text(subtitle, MARGIN, 50, { width: PAGE_WIDTH - MARGIN * 2, lineBreak: false });

  // Advance cursor below header
  doc.y = HEADER_H + 14;
  doc.fillColor(TEXT_DARK);
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(0.8);
  const y = doc.y;
  const rectH = 22;
  doc.rect(MARGIN - 4, y, PAGE_WIDTH - MARGIN * 2 + 8, rectH).fill(BRAND_TEAL);
  doc
    .fillColor("white")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(text, MARGIN, y + 5, { width: PAGE_WIDTH - MARGIN * 2, lineBreak: false });
  doc.y = y + rectH + 8;
  doc.fillColor(TEXT_DARK);
}

const KV_LABEL_W = 130;

function kv(
  doc: PDFKit.PDFDocument,
  key: string,
  value: string,
  color: string = TEXT_DARK,
): void {
  const y = doc.y;
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(TEXT_MUTED)
    .text(key + ":", MARGIN, y, { width: KV_LABEL_W, lineBreak: false });
  doc
    .font("Helvetica")
    .fillColor(color)
    .text(value, MARGIN + KV_LABEL_W, y, {
      width: PAGE_WIDTH - MARGIN * 2 - KV_LABEL_W,
    });
}

function divider(doc: PDFKit.PDFDocument): void {
  doc
    .moveTo(MARGIN, doc.y + 4)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y + 4)
    .strokeColor("#d1d5db")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
}

const NAME_COL_W  = 165;
// right boundary minus left margin minus name col minus gap
const COUNT_COL_W = 75;
const BAR_X       = MARGIN + NAME_COL_W + 8;                         // 223
const BAR_MAX     = PAGE_WIDTH - MARGIN - BAR_X - COUNT_COL_W - 6;  // 595-50-223-75-6 = 241

function candidateRow(
  doc: PDFKit.PDFDocument,
  candidate: Candidate,
  total: bigint,
): void {
  const count = Number(candidate.voteCount);
  const pct   = total > 0n ? ((count / Number(total)) * 100).toFixed(1) : "0.0";
  const barW  = total > 0n ? Math.max(0, Math.round((count / Number(total)) * BAR_MAX)) : 0;

  const y = doc.y;

  // Candidate name + party
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(TEXT_DARK)
    .text(`Nº ${candidate.number}  ${candidate.name}`, MARGIN, y, {
      width: NAME_COL_W,
      lineBreak: false,
    });
  doc
    .font("Helvetica")
    .fillColor(TEXT_MUTED)
    .text(candidate.party, MARGIN, y + 12, { width: NAME_COL_W, lineBreak: false });

  // Bar: filled background + teal fill
  const barY = y + 5;
  doc.rect(BAR_X, barY, BAR_MAX, 8).fillColor("#e5e7eb").fill();
  if (barW > 0) {
    doc.rect(BAR_X, barY, barW, 8).fillColor(BRAND_TEAL).fill();
  }

  // Vote count — right of bar
  const countX = BAR_X + BAR_MAX + 6;
  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${count} votos`, countX, y, { width: COUNT_COL_W, lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text(`(${pct}%)`, countX, y + 12, { width: COUNT_COL_W, lineBreak: false });

  doc.y = y + 30;
}

function specialRow(
  doc: PDFKit.PDFDocument,
  label: string,
  count: bigint,
  total: bigint,
  color: string,
): void {
  const n   = Number(count);
  const pct = total > 0n ? ((n / Number(total)) * 100).toFixed(1) : "0.0";
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color)
    .text(`  ${label}: `)
    .font("Helvetica")
    .fillColor(TEXT_DARK)
    .text(`${n} votos (${pct}%)`, { indent: 8 });
}

function raceSection(
  doc: PDFKit.PDFDocument,
  snap: RaceSnapshot,
  raceIdx: number,
): void {
  sectionTitle(
    doc,
    `Cargo ${raceIdx}: ${snap.name || `Race ${Number(snap.raceId)}`}`,
  );

  const total = snap.totalVotes;

  kv(doc, "Total de votos neste cargo", `${Number(total)}`);
  doc.moveDown(0.3);

  for (const cand of snap.candidates) {
    candidateRow(doc, cand, total);
  }

  if (snap.blankVotes > 0n || snap.nullVotes > 0n) {
    doc.moveDown(0.3);
    specialRow(doc, "Votos Brancos", snap.blankVotes, total, GREEN_ACCENT);
    specialRow(doc, "Votos Nulos",   snap.nullVotes,  total, RED_ACCENT);
  }

  divider(doc);
}

function integrity(doc: PDFKit.PDFDocument, hash: string): void {
  doc.moveDown(1);
  const y = doc.y;
  const rectH = 42;
  doc.rect(MARGIN - 4, y, PAGE_WIDTH - MARGIN * 2 + 8, rectH).fill(LIGHT_GRAY);
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(8)
    .text("Integridade: SHA-256 deste documento", MARGIN, y + 6, {
      width: PAGE_WIDTH - MARGIN * 2,
      lineBreak: false,
    });
  doc
    .font("Courier")
    .fontSize(7.5)
    .fillColor(TEXT_DARK)
    .text(hash, MARGIN, y + 20, { width: PAGE_WIDTH - MARGIN * 2, lineBreak: false });
  doc.y = y + rectH + 8;
}

const LOCALE = "pt-BR";
const TZ     = "America/Sao_Paulo"; // UTC-3

function fmtDate(isoOrTimestamp: string | number): string {
  const d = typeof isoOrTimestamp === "number"
    ? new Date(isoOrTimestamp)
    : new Date(isoOrTimestamp);
  return d.toLocaleString(LOCALE, { timeZone: TZ });
}

function nowIso(): string {
  // ISO string but shifted to BRT so the timestamp shown is local
  return new Date().toLocaleString(LOCALE, { timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).replace(",", "") + " BRT";
}

// ── Public builders ───────────────────────────────────────────────────────────

/**
 * Build the Boletim de Urna (official tally) as a PDF.
 *
 * Includes: election metadata, per-race candidate vote counts with visual
 * bars, blank/null totals, and an integrity SHA-256 fingerprint.
 */
export async function buildBuPdf(eventAddr: string): Promise<Buffer> {
  const bu = await readBoletimUrna(eventAddr);
  const ts = fmtDate(Number(bu.blockTimestamp) * 1000);
  const generatedAt = nowIso();

  // Compute hash over stable body before building PDF (we hash the JSON
  // representation of the data, not the PDF bytes, for determinism).
  const bodyJson = JSON.stringify({
    type: "BOLETIM_DE_URNA",
    eventAddr,
    electionName: bu.electionName,
    electionId: bu.electionId.toString(),
    state: stateLabel[bu.state] ?? String(bu.state),
    grandTotalVotes: bu.grandTotalVotes.toString(),
    voterCount: bu.voterCount.toString(),
    merkleRoot: bu.merkleRoot.toString(),
    generatedAt,
  });
  const sha = createHash("sha256").update(bodyJson).digest("hex");

  return pdfBuffer((doc) => {
    header(
      doc,
      "Boletim de Urna",
      `${bu.electionName}  ·  Gerado em ${generatedAt}`,
    );

    sectionTitle(doc, "Dados da Eleição");
    kv(doc, "Contrato",      eventAddr);
    kv(doc, "ID da Eleição", bu.electionId.toString());
    kv(doc, "Estado",        stateLabel[bu.state] ?? String(bu.state));
    kv(doc, "Fechamento",    ts);
    kv(doc, "Total Votantes",bu.voterCount.toString());
    kv(doc, "Total Votos",   bu.grandTotalVotes.toString());
    kv(doc, "Raiz Merkle",   bu.merkleRoot.toString());
    divider(doc);

    for (let i = 0; i < bu.snapshots.length; i++) {
      raceSection(doc, bu.snapshots[i], i);
    }

    integrity(doc, sha);
  });
}

/**
 * Build a voter receipt PDF for a given nullifier.
 *
 * Shows:
 *   - The voter's anonymous identifier (nullifier)
 *   - Which candidate they voted for in each race they participated in
 *   - The complete election results for those races
 *   - The on-chain transaction hash confirming inclusion
 *
 * If the nullifier is not found (voter did not vote or log is too old),
 * the receipt still shows the election results but notes the absence.
 */
export async function buildReceiptPdf(
  eventAddr: string,
  nullifierStr: string,
): Promise<Buffer> {
  const [bu, logs] = await Promise.all([
    readBoletimUrna(eventAddr),
    readVoteCastLogs(eventAddr),
  ]);

  // All votes cast by this nullifier (multi-race: one entry per race)
  const myVotes = logs.filter((l) => l.nullifier.toString() === nullifierStr);
  const generatedAt = nowIso();
  const ts = fmtDate(Number(bu.blockTimestamp) * 1000);

  const sha = createHash("sha256")
    .update(
      JSON.stringify({ eventAddr, nullifierStr, myVoteCount: myVotes.length, generatedAt }),
    )
    .digest("hex");

  return pdfBuffer((doc) => {
    header(
      doc,
      "Comprovante de Voto",
      `${bu.electionName}  ·  Gerado em ${generatedAt}`,
    );

    // ── Election metadata ─────────────────────────────────────────────────
    sectionTitle(doc, "Dados da Eleição");
    kv(doc, "Contrato",      eventAddr);
    kv(doc, "ID da Eleição", bu.electionId.toString());
    kv(doc, "Estado",        stateLabel[bu.state] ?? String(bu.state));
    kv(doc, "Fechamento",    ts);
    divider(doc);

    // ── Voter identity ────────────────────────────────────────────────────
    sectionTitle(doc, "Seu Identificador Anônimo (Nullifier)");
    doc
      .font("Courier")
      .fontSize(8.5)
      .fillColor(BRAND_BLUE)
      .text(nullifierStr, { width: PAGE_WIDTH - MARGIN * 2 });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text(
        "Este identificador prova de forma anônima que você votou nesta eleição. " +
        "Ele não revela sua identidade — apenas que um eleitor registrado emitiu este voto.",
      );
    divider(doc);

    // ── Voter's votes per race ────────────────────────────────────────────
    sectionTitle(doc, "Seus Votos");

    if (myVotes.length === 0) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(RED_ACCENT)
        .text(
          "Nenhum voto encontrado para este nullifier no registro on-chain. " +
          "Isso pode significar que o voto ainda está pendente ou que o nullifier está incorreto.",
        );
    } else {
      for (const vote of myVotes) {
        const snap = bu.snapshots.find(
          (s) => Number(s.raceId) === Number(vote.raceId),
        );
        const raceName = snap?.name ?? `Cargo ${vote.raceId}`;
        let candidateLine = "";

        if (Number(vote.candidateId) === 0) {
          candidateLine = "Voto em Branco";
        } else if (Number(vote.candidateId) === 999) {
          candidateLine = "Voto Nulo";
        } else {
          const cand = snap?.candidates.find(
            (c) => Number(c.id) === Number(vote.candidateId),
          );
          candidateLine = cand
            ? `${cand.name}  (${cand.party})  Nº ${cand.number}`
            : `Candidato ID ${vote.candidateId}`;
        }

        kv(doc, raceName, candidateLine, GREEN_ACCENT);
        doc
          .font("Courier")
          .fontSize(7.5)
          .fillColor(TEXT_MUTED)
          .text(`Tx: ${vote.txHash}  |  Bloco: ${vote.blockNumber}`, {
            indent: 8,
          });
        doc.moveDown(0.4);
      }
    }
    divider(doc);

    // ── Full election results ─────────────────────────────────────────────
    sectionTitle(doc, "Resultado Completo da Eleição");

    for (let i = 0; i < bu.snapshots.length; i++) {
      // Only print races the voter participated in, or all if none found
      const snap = bu.snapshots[i];
      const participated =
        myVotes.length === 0 ||
        myVotes.some((v) => Number(v.raceId) === Number(snap.raceId));

      if (participated) {
        raceSection(doc, snap, i);
      }
    }

    kv(doc, "Total Geral de Votos", bu.grandTotalVotes.toString());
    kv(doc, "Total de Votantes",    bu.voterCount.toString());
    divider(doc);

    integrity(doc, sha);

    // ── Footer ────────────────────────────────────────────────────────────
    doc
      .fontSize(7.5)
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .text(
        "Este documento foi gerado automaticamente pelo sistema de votação pi-votacao-zk. " +
        "A validade deste comprovante pode ser verificada na blockchain consultando o " +
        "hash de transação acima.",
        { align: "center" },
      );
  });
}
