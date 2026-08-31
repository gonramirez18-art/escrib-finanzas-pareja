import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Trash2, Check, Clock, PiggyBank, Receipt, X, Pencil } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { loadState, saveState as saveStateApi } from "./lib/api.js";

const POLL_MS = 4000;

const DEFAULT_CATEGORIES = [
  "Vivienda",
  "Alimentación",
  "Transporte",
  "Servicios",
  "Salud",
  "Entretenimiento",
  "Otros",
];

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr) => dateStr.slice(0, 7);

const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );

const monthLabel = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState({ A: "Vos", B: "Tu pareja" });
  const [txs, setTxs] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  const [monthFilter, setMonthFilter] = useState(todayStr().slice(0, 7));
  const [personFilter, setPersonFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");

  const [formOpen, setFormOpen] = useState(false);
  const [editingNames, setEditingNames] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error

  // Evita que una actualización que llega del otro celular (polling) dispare
  // un guardado de vuelta al servidor (lo que crearía un ida-y-vuelta infinito).
  const skipNextSave = useRef(false);
  const applyRemote = (remote) => {
    if (!remote) return;
    skipNextSave.current = true;
    if (remote.people) setPeople(remote.people);
    if (remote.txs) setTxs(remote.txs);
    if (remote.categories) setCategories(remote.categories);
  };

  // ---- carga inicial ----
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadState();
        applyRemote(remote);
      } catch (e) {
        // primera vez, todavía no hay datos guardados
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ---- guardado (debounced) ----
  const persist = useCallback((next) => {
    setSaveStatus("saving");
    saveStateApi(next)
      .then(() => setSaveStatus("saved"))
      .catch(() => setSaveStatus("error"));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const t = setTimeout(() => persist({ people, txs, categories }), 350);
    return () => clearTimeout(t);
  }, [people, txs, categories, loaded, persist]);

  // ---- polling: cada POLL_MS revisa si el otro celular cambió algo ----
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(async () => {
      try {
        const remote = await loadState();
        if (!remote) return;
        const localSnapshot = JSON.stringify({ people, txs, categories });
        const remoteSnapshot = JSON.stringify({
          people: remote.people ?? people,
          txs: remote.txs ?? txs,
          categories: remote.categories ?? categories,
        });
        if (localSnapshot !== remoteSnapshot) applyRemote(remote);
      } catch (e) {
        // si falla un ciclo de polling, se reintenta en el siguiente
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loaded, people, txs, categories]);

  // ---- derived ----
  const months = useMemo(() => {
    const s = new Set(txs.map((t) => monthKey(t.date)));
    s.add(todayStr().slice(0, 7));
    return Array.from(s).sort().reverse();
  }, [txs]);

  const filtered = useMemo(() => {
    return txs
      .filter((t) => monthKey(t.date) === monthFilter)
      .filter((t) => personFilter === "todos" || t.who === personFilter)
      .filter((t) => statusFilter === "todos" || t.status === statusFilter)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [txs, monthFilter, personFilter, statusFilter]);

  const monthTxs = useMemo(() => txs.filter((t) => monthKey(t.date) === monthFilter), [txs, monthFilter]);

  const totals = useMemo(() => {
    let gastoPagado = 0,
      gastoPendiente = 0,
      aporteA = 0,
      aporteB = 0,
      pagadoA = 0,
      pagadoB = 0,
      pagadoComun = 0;

    monthTxs.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (t.kind === "gasto") {
        if (t.status === "pagado") {
          gastoPagado += amt;
          if (t.who === "A") pagadoA += amt;
          else if (t.who === "B") pagadoB += amt;
          else pagadoComun += amt;
        } else {
          gastoPendiente += amt;
        }
      } else {
        if (t.who === "A") aporteA += amt;
        else if (t.who === "B") aporteB += amt;
      }
    });

    const puestoA = pagadoA + aporteA;
    const puestoB = pagadoB + aporteB;

    return {
      gastoPagado,
      gastoPendiente,
      aporteA,
      aporteB,
      pagadoA,
      pagadoB,
      pagadoComun,
      puestoA,
      puestoB,
      diferencia: puestoA - puestoB,
    };
  }, [monthTxs]);

  // Saldo de la cuenta común: acumulado histórico, no solo del mes filtrado.
  const cuentaComun = useMemo(() => {
    let aportado = 0,
      gastado = 0;
    txs.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (t.kind === "aporte") aportado += amt;
      else if (t.kind === "gasto" && t.who === "comun" && t.status === "pagado") gastado += amt;
    });
    return { aportado, gastado, saldo: aportado - gastado };
  }, [txs]);

  // Diferencia acumulada: recorre todo el historial mes a mes para que el
  // "quién puso más" no se resetee cada mes, sino que se arrastre.
  const historialDiferencias = useMemo(() => {
    const porMes = {};
    txs.forEach((t) => {
      const mk = monthKey(t.date);
      if (!porMes[mk]) porMes[mk] = { puestoA: 0, puestoB: 0 };
      const amt = Number(t.amount) || 0;
      if (t.kind === "gasto" && t.status === "pagado") {
        if (t.who === "A") porMes[mk].puestoA += amt;
        else if (t.who === "B") porMes[mk].puestoB += amt;
      } else if (t.kind === "aporte") {
        if (t.who === "A") porMes[mk].puestoA += amt;
        else if (t.who === "B") porMes[mk].puestoB += amt;
      }
    });

    let acumulado = 0;
    const meses = Object.keys(porMes)
      .sort()
      .map((mk) => {
        const diferenciaMes = porMes[mk].puestoA - porMes[mk].puestoB;
        acumulado += diferenciaMes;
        return { mes: mk, diferenciaMes, acumulado };
      });

    return { meses, totalAcumulado: acumulado };
  }, [txs]);

  const categoryData = useMemo(() => {
    const map = {};
    monthTxs
      .filter((t) => t.kind === "gasto" && t.status === "pagado")
      .forEach((t) => {
        map[t.category] = (map[t.category] || 0) + (Number(t.amount) || 0);
      });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [monthTxs]);

  // ---- actions ----
  const addTx = (tx) => setTxs((prev) => [...prev, { ...tx, id: uid() }]);
  const removeTx = (id) => setTxs((prev) => prev.filter((t) => t.id !== id));

  // Si ya está pagado, un clic lo vuelve a pendiente directo.
  // Si está pendiente, no sabemos quién lo va a pagar todavía: abrimos el modal para preguntarlo.
  const handleToggle = (id) => {
    const tx = txs.find((t) => t.id === id);
    if (!tx) return;
    if (tx.status === "pagado") {
      setTxs((prev) => prev.map((t) => (t.id === id ? { ...t, status: "pendiente" } : t)));
    } else {
      setAssigningId(id);
    }
  };

  const confirmPayment = (who) => {
    setTxs((prev) => prev.map((t) => (t.id === assigningId ? { ...t, who, status: "pagado" } : t)));
    setAssigningId(null);
  };

  if (!loaded) {
    return (
      <div className="fp-root fp-loading">
        <div className="fp-spinner" />
      </div>
    );
  }

  return (
    <div className="fp-root">
      <style>{CSS}</style>

      <header className="fp-header">
        <div className="fp-header-top">
          <h1>Libro de cuentas</h1>
          <span className={`fp-save fp-save-${saveStatus}`}>
            {saveStatus === "saving" ? "Guardando…" : saveStatus === "error" ? "Sin conexión" : "Guardado"}
          </span>
        </div>
        <NamesEditor
          people={people}
          editing={editingNames}
          setEditing={setEditingNames}
          onSave={(p) => {
            setPeople(p);
            setEditingNames(false);
          }}
        />
        <p className="fp-note">
          Los datos se comparten entre quien tenga este link. Se sincroniza automáticamente cada pocos segundos.
        </p>
      </header>

      <section className="fp-comun-card">
        <div>
          <div className="fp-comun-label">Saldo en cuenta común</div>
          <div className="fp-comun-value">{fmt(cuentaComun.saldo)}</div>
        </div>
        <div className="fp-comun-breakdown">
          <span>+ {fmt(cuentaComun.aportado)} aportado</span>
          <span>− {fmt(cuentaComun.gastado)} gastado</span>
        </div>
      </section>

      <section className="fp-monthbar">
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="fp-select fp-month-select">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </section>

      <section className="fp-summary">
        <div className="fp-ledger-card">
          <div className="fp-ledger-row fp-ledger-head">
            <span></span>
            <span>{people.A}</span>
            <span>{people.B}</span>
          </div>
          <div className="fp-ledger-row">
            <span className="fp-ledger-label">Pagó gastos</span>
            <span className="fp-num">{fmt(totals.pagadoA)}</span>
            <span className="fp-num">{fmt(totals.pagadoB)}</span>
          </div>
          <div className="fp-ledger-row">
            <span className="fp-ledger-label">Aportó a fondos</span>
            <span className="fp-num">{fmt(totals.aporteA)}</span>
            <span className="fp-num">{fmt(totals.aporteB)}</span>
          </div>
          <div className="fp-ledger-row fp-ledger-total">
            <span className="fp-ledger-label">Total puesto</span>
            <span className="fp-num">{fmt(totals.puestoA)}</span>
            <span className="fp-num">{fmt(totals.puestoB)}</span>
          </div>
          <div className="fp-balance">
            {totals.diferencia === 0 ? (
              <span>Están a mano este mes.</span>
            ) : totals.diferencia > 0 ? (
              <>
                <span>
                  <strong>{people.A}</strong> puso {fmt(Math.abs(totals.diferencia))} más que {people.B}.
                </span>
                <div className="fp-debe">
                  → <strong>{people.B}</strong> le debe <strong>{fmt(Math.abs(totals.diferencia) / 2)}</strong> a{" "}
                  {people.A} para quedar a mano.
                </div>
              </>
            ) : (
              <>
                <span>
                  <strong>{people.B}</strong> puso {fmt(Math.abs(totals.diferencia))} más que {people.A}.
                </span>
                <div className="fp-debe">
                  → <strong>{people.A}</strong> le debe <strong>{fmt(Math.abs(totals.diferencia) / 2)}</strong> a{" "}
                  {people.B} para quedar a mano.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="fp-stat-col">
          <div className="fp-stat">
            <Check size={16} strokeWidth={2.25} />
            <div>
              <div className="fp-stat-value">{fmt(totals.gastoPagado)}</div>
              <div className="fp-stat-label">Pagado este mes</div>
            </div>
          </div>
          <div className="fp-stat fp-stat-pending">
            <Clock size={16} strokeWidth={2.25} />
            <div>
              <div className="fp-stat-value">{fmt(totals.gastoPendiente)}</div>
              <div className="fp-stat-label">Pendiente de pagar</div>
            </div>
          </div>
          <div className="fp-stat">
            <PiggyBank size={16} strokeWidth={2.25} />
            <div>
              <div className="fp-stat-value">{fmt(totals.aporteA + totals.aporteB)}</div>
              <div className="fp-stat-label">Aportado a fondos comunes</div>
            </div>
          </div>
        </div>
      </section>

      {historialDiferencias.meses.length > 0 && (
        <section className="fp-acumulado">
          <div className="fp-acumulado-head" onClick={() => setShowHistorial((v) => !v)}>
            <div>
              <div className="fp-acumulado-label">Diferencia acumulada (todos los meses)</div>
              <div className="fp-acumulado-value">
                {historialDiferencias.totalAcumulado === 0 ? (
                  "Están a mano"
                ) : historialDiferencias.totalAcumulado > 0 ? (
                  <>
                    {people.A} va {fmt(Math.abs(historialDiferencias.totalAcumulado))} arriba
                  </>
                ) : (
                  <>
                    {people.B} va {fmt(Math.abs(historialDiferencias.totalAcumulado))} arriba
                  </>
                )}
              </div>
              {historialDiferencias.totalAcumulado !== 0 && (
                <div className="fp-acumulado-debe">
                  {historialDiferencias.totalAcumulado > 0 ? people.B : people.A} le debe{" "}
                  {fmt(Math.abs(historialDiferencias.totalAcumulado) / 2)} a{" "}
                  {historialDiferencias.totalAcumulado > 0 ? people.A : people.B} para quedar a mano.
                </div>
              )}
            </div>
            <button type="button" className="fp-acumulado-toggle">
              {showHistorial ? "Ocultar detalle" : "Ver detalle"}
            </button>
          </div>

          {showHistorial && (
            <div className="fp-historial-list">
              <div className="fp-historial-row fp-historial-head">
                <span>Mes</span>
                <span>Diferencia del mes</span>
                <span>Acumulado</span>
              </div>
              {historialDiferencias.meses
                .slice()
                .reverse()
                .map((m) => (
                  <div className="fp-historial-row" key={m.mes}>
                    <span>{monthLabel(m.mes)}</span>
                    <span className="fp-num">
                      {m.diferenciaMes === 0
                        ? "—"
                        : `${m.diferenciaMes > 0 ? people.A : people.B} +${fmt(Math.abs(m.diferenciaMes))}`}
                    </span>
                    <span className="fp-num">
                      {m.acumulado === 0
                        ? "—"
                        : `${m.acumulado > 0 ? people.A : people.B} +${fmt(Math.abs(m.acumulado))}`}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      {categoryData.length > 0 && (
        <section className="fp-chart">
          <h2>Gastos por categoría</h2>
          <ResponsiveContainer width="100%" height={Math.max(120, categoryData.length * 34)}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--fp-line)" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fill: "var(--fp-ink)", fontSize: 12, fontFamily: "var(--fp-font-body)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v) => fmt(v)}
                contentStyle={{
                  background: "var(--fp-paper)",
                  border: "1px solid var(--fp-line)",
                  borderRadius: 4,
                  fontFamily: "var(--fp-font-body)",
                  fontSize: 13,
                }}
              />
              <Bar dataKey="value" fill="var(--fp-teal)" radius={[0, 3, 3, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      <section className="fp-list-header">
        <h2>Movimientos</h2>
        <div className="fp-filters">
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="fp-select">
            <option value="todos">Todos</option>
            <option value="A">{people.A}</option>
            <option value="B">{people.B}</option>
            <option value="comun">Cuenta común</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="fp-select">
            <option value="todos">Todo estado</option>
            <option value="pagado">Pagado</option>
            <option value="pendiente">Pendiente</option>
          </select>
          <button className="fp-btn-add" onClick={() => setFormOpen(true)}>
            <Plus size={16} strokeWidth={2.5} /> Agregar
          </button>
        </div>
      </section>

      <section className="fp-list">
        {filtered.length === 0 && (
          <div className="fp-empty">No hay movimientos para este filtro. Agregá el primero del mes.</div>
        )}
        {filtered.map((t) => (
          <TxRow key={t.id} tx={t} people={people} onToggle={() => handleToggle(t.id)} onRemove={() => removeTx(t.id)} />
        ))}
      </section>

      {formOpen && (
        <TxForm
          people={people}
          categories={categories}
          setCategories={setCategories}
          defaultDate={monthFilter === todayStr().slice(0, 7) ? todayStr() : `${monthFilter}-01`}
          onCancel={() => setFormOpen(false)}
          onSubmit={(tx) => {
            addTx(tx);
            setFormOpen(false);
          }}
        />
      )}

      {assigningId &&
        (() => {
          const tx = txs.find((t) => t.id === assigningId);
          if (!tx) return null;
          return (
            <AssignPaidModal tx={tx} people={people} onCancel={() => setAssigningId(null)} onConfirm={confirmPayment} />
          );
        })()}
    </div>
  );
}

function AssignPaidModal({ tx, people, onCancel, onConfirm }) {
  return (
    <div className="fp-modal-overlay" onClick={onCancel}>
      <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fp-modal-head">
          <h3>¿Quién lo pagó?</h3>
          <button type="button" className="fp-icon-btn" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="fp-assign-summary">
          {tx.description || tx.category} · {fmt(tx.amount)}
        </p>
        <div className="fp-who-toggle fp-who-toggle-assign">
          <button type="button" onClick={() => onConfirm("A")}>
            {people.A}
          </button>
          <button type="button" onClick={() => onConfirm("B")}>
            {people.B}
          </button>
          <button type="button" onClick={() => onConfirm("comun")}>
            Cuenta común
          </button>
        </div>
      </div>
    </div>
  );
}

function NamesEditor({ people, editing, setEditing, onSave }) {
  const [a, setA] = useState(people.A);
  const [b, setB] = useState(people.B);

  useEffect(() => {
    setA(people.A);
    setB(people.B);
  }, [people, editing]);

  if (!editing) {
    return (
      <button className="fp-names-display" onClick={() => setEditing(true)}>
        {people.A} &amp; {people.B} <Pencil size={12} strokeWidth={2.25} />
      </button>
    );
  }

  return (
    <div className="fp-names-edit">
      <input value={a} onChange={(e) => setA(e.target.value)} placeholder="Nombre 1" />
      <span>&amp;</span>
      <input value={b} onChange={(e) => setB(e.target.value)} placeholder="Nombre 2" />
      <button className="fp-btn-mini" onClick={() => onSave({ A: a || "Persona 1", B: b || "Persona 2" })}>
        Guardar
      </button>
    </div>
  );
}

function TxRow({ tx, people, onToggle, onRemove }) {
  const whoLabel =
    tx.who === "A" ? people.A : tx.who === "B" ? people.B : tx.who === "comun" ? "Cuenta común" : "Sin asignar";
  const isGasto = tx.kind === "gasto";
  const cuotaLabel =
    isGasto && tx.paymentType === "cuotas" && tx.installment ? `Cuota ${tx.installment.current}/${tx.installment.total}` : null;
  return (
    <div className={`fp-row ${tx.status === "pendiente" ? "fp-row-pending" : ""}`}>
      <div className="fp-row-icon">{isGasto ? <Receipt size={15} /> : <PiggyBank size={15} />}</div>
      <div className="fp-row-main">
        <div className="fp-row-desc">{tx.description || (isGasto ? tx.category : "Aporte")}</div>
        <div className="fp-row-meta">
          {tx.date} · {isGasto ? tx.category : tx.pot} · {whoLabel}
          {cuotaLabel ? ` · ${cuotaLabel}` : ""}
        </div>
      </div>
      <div className="fp-row-amount">{fmt(tx.amount)}</div>
      {isGasto ? (
        <button className={`fp-status-pill fp-status-${tx.status}`} onClick={onToggle}>
          {tx.status === "pagado" ? "Pagado" : "Pendiente"}
        </button>
      ) : (
        <span className="fp-status-pill fp-status-aporte">Aporte</span>
      )}
      <button className="fp-row-del" onClick={onRemove} aria-label="Eliminar">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function TxForm({ people, categories, setCategories, defaultDate, onCancel, onSubmit }) {
  const [kind, setKind] = useState("gasto");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState(categories[0]);
  const [newCategory, setNewCategory] = useState("");
  const [who, setWho] = useState("A");
  const [status, setStatus] = useState("pagado");
  const [pot, setPot] = useState("Ahorro común");
  const [paymentType, setPaymentType] = useState("unico");
  const [installmentCurrent, setInstallmentCurrent] = useState("1");
  const [installmentTotal, setInstallmentTotal] = useState("2");

  const submit = (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;

    let finalCategory = category;
    if (kind === "gasto" && category === "__nueva__") {
      finalCategory = newCategory.trim() || "Otros";
      if (finalCategory && !categories.includes(finalCategory)) {
        setCategories((prev) => [...prev, finalCategory]);
      }
    }

    onSubmit({
      kind,
      description: description.trim(),
      amount: Number(amount),
      date,
      category: kind === "gasto" ? finalCategory : null,
      who: kind === "gasto" && status === "pendiente" ? null : who,
      status: kind === "gasto" ? status : "pagado",
      pot: kind === "aporte" ? pot.trim() || "Ahorro común" : null,
      paymentType: kind === "gasto" ? paymentType : null,
      installment:
        kind === "gasto" && paymentType === "cuotas"
          ? { current: Number(installmentCurrent) || 1, total: Number(installmentTotal) || 1 }
          : null,
    });
  };

  return (
    <div className="fp-modal-overlay" onClick={onCancel}>
      <form className="fp-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="fp-modal-head">
          <h3>Nuevo movimiento</h3>
          <button type="button" className="fp-icon-btn" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="fp-kind-toggle">
          <button type="button" className={kind === "gasto" ? "active" : ""} onClick={() => setKind("gasto")}>
            Gasto
          </button>
          <button type="button" className={kind === "aporte" ? "active" : ""} onClick={() => setKind("aporte")}>
            Aporte a fondo
          </button>
        </div>

        <label className="fp-field">
          <span>Descripción</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "gasto" ? "Ej: Supermercado" : "Ej: Aporte mensual a ahorro"}
          />
        </label>

        <div className="fp-field-row">
          <label className="fp-field">
            <span>Monto</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="fp-field">
            <span>Fecha</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {kind === "gasto" ? (
          <>
            <label className="fp-field">
              <span>Categoría</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__nueva__">+ Nueva categoría…</option>
              </select>
            </label>
            {category === "__nueva__" && (
              <label className="fp-field">
                <span>Nombre de la categoría</span>
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Ej: Mascotas" />
              </label>
            )}

            <label className="fp-field">
              <span>Estado</span>
              <div className="fp-who-toggle">
                <button type="button" className={status === "pagado" ? "active" : ""} onClick={() => setStatus("pagado")}>
                  Pagado
                </button>
                <button
                  type="button"
                  className={status === "pendiente" ? "active" : ""}
                  onClick={() => setStatus("pendiente")}
                >
                  Pendiente
                </button>
              </div>
            </label>

            {status === "pagado" ? (
              <label className="fp-field">
                <span>¿Quién pagó?</span>
                <div className="fp-who-toggle">
                  <button type="button" className={who === "A" ? "active" : ""} onClick={() => setWho("A")}>
                    {people.A}
                  </button>
                  <button type="button" className={who === "B" ? "active" : ""} onClick={() => setWho("B")}>
                    {people.B}
                  </button>
                  <button type="button" className={who === "comun" ? "active" : ""} onClick={() => setWho("comun")}>
                    Cuenta común
                  </button>
                </div>
              </label>
            ) : (
              <p className="fp-pending-note">Vas a elegir quién lo pagó cuando lo marques como pagado.</p>
            )}

            <label className="fp-field">
              <span>Forma de pago</span>
              <div className="fp-who-toggle">
                <button
                  type="button"
                  className={paymentType === "unico" ? "active" : ""}
                  onClick={() => setPaymentType("unico")}
                >
                  Pago único
                </button>
                <button
                  type="button"
                  className={paymentType === "cuotas" ? "active" : ""}
                  onClick={() => setPaymentType("cuotas")}
                >
                  En cuotas
                </button>
              </div>
            </label>

            {paymentType === "cuotas" && (
              <div className="fp-field-row">
                <label className="fp-field">
                  <span>Cuota actual</span>
                  <input
                    type="number"
                    min="1"
                    value={installmentCurrent}
                    onChange={(e) => setInstallmentCurrent(e.target.value)}
                  />
                </label>
                <label className="fp-field">
                  <span>Cuotas totales</span>
                  <input
                    type="number"
                    min="1"
                    value={installmentTotal}
                    onChange={(e) => setInstallmentTotal(e.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="fp-field">
              <span>¿Quién aportó?</span>
              <div className="fp-who-toggle">
                <button type="button" className={who === "A" ? "active" : ""} onClick={() => setWho("A")}>
                  {people.A}
                </button>
                <button type="button" className={who === "B" ? "active" : ""} onClick={() => setWho("B")}>
                  {people.B}
                </button>
              </div>
            </label>
            <label className="fp-field">
              <span>Destino del aporte</span>
              <input value={pot} onChange={(e) => setPot(e.target.value)} placeholder="Ahorro, cuenta común, viaje…" />
            </label>
          </>
        )}

        <button type="submit" className="fp-btn-submit">
          Guardar movimiento
        </button>
      </form>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap');

.fp-root {
  --fp-paper: #F6F4EC;
  --fp-paper-raised: #FFFFFF;
  --fp-ink: #232B24;
  --fp-ink-soft: #5B6459;
  --fp-line: #DCD8C8;
  --fp-teal: #3B6E5C;
  --fp-teal-soft: #E4EDE8;
  --fp-rust: #8C4A3D;
  --fp-rust-soft: #F3E5E1;
  --fp-gold: #B5872B;
  --fp-gold-soft: #F5EBD3;
  --fp-font-display: 'Fraunces', serif;
  --fp-font-body: 'Inter', sans-serif;
  --fp-font-mono: 'IBM Plex Mono', monospace;

  background: var(--fp-paper);
  color: var(--fp-ink);
  font-family: var(--fp-font-body);
  min-height: 100%;
  padding: 28px 20px 60px;
  max-width: 720px;
  margin: 0 auto;
  box-sizing: border-box;
}
.fp-root * { box-sizing: border-box; }

.fp-loading { display: flex; align-items: center; justify-content: center; min-height: 300px; }
.fp-spinner { width: 22px; height: 22px; border: 2px solid var(--fp-line); border-top-color: var(--fp-teal); border-radius: 50%; animation: fp-spin 0.8s linear infinite; }
@keyframes fp-spin { to { transform: rotate(360deg); } }

.fp-header-top { display: flex; align-items: baseline; justify-content: space-between; }
.fp-header h1 {
  font-family: var(--fp-font-display);
  font-weight: 700;
  font-size: 30px;
  margin: 0;
  letter-spacing: -0.01em;
}
.fp-save { font-size: 11px; color: var(--fp-ink-soft); font-family: var(--fp-font-mono); }
.fp-save-saving { color: var(--fp-gold); }
.fp-save-error { color: var(--fp-rust); }

.fp-names-display {
  margin-top: 6px;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--fp-font-body);
  font-size: 14px;
  color: var(--fp-ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.fp-names-edit { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.fp-names-edit input {
  font-family: var(--fp-font-body);
  font-size: 14px;
  border: 1px solid var(--fp-line);
  border-radius: 4px;
  padding: 5px 8px;
  background: var(--fp-paper-raised);
  color: var(--fp-ink);
  width: 120px;
}
.fp-btn-mini {
  font-family: var(--fp-font-body);
  font-size: 13px;
  background: var(--fp-ink);
  color: var(--fp-paper);
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
}

.fp-note { font-size: 12px; color: var(--fp-ink-soft); margin: 10px 0 0; line-height: 1.5; }

.fp-comun-card {
  margin-top: 20px;
  background: var(--fp-ink);
  color: var(--fp-paper);
  border-radius: 8px;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.fp-comun-label { font-size: 12px; opacity: 0.75; }
.fp-comun-value { font-family: var(--fp-font-mono); font-size: 22px; font-weight: 600; margin-top: 2px; }
.fp-comun-breakdown { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 11.5px; opacity: 0.8; font-family: var(--fp-font-mono); }

.fp-monthbar { margin-top: 22px; }
.fp-select {
  font-family: var(--fp-font-body);
  font-size: 13px;
  border: 1px solid var(--fp-line);
  background: var(--fp-paper-raised);
  color: var(--fp-ink);
  border-radius: 4px;
  padding: 6px 8px;
}
.fp-month-select { font-size: 15px; font-weight: 500; padding: 7px 10px; }

.fp-summary { margin-top: 18px; display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
@media (max-width: 560px) { .fp-summary { grid-template-columns: 1fr; } }

.fp-ledger-card {
  background: var(--fp-paper-raised);
  border: 1px solid var(--fp-line);
  border-radius: 6px;
  padding: 16px 18px;
}
.fp-ledger-row { display: grid; grid-template-columns: 1fr 90px 90px; gap: 8px; align-items: center; padding: 7px 0; }
.fp-ledger-head { font-family: var(--fp-font-body); font-weight: 600; font-size: 13px; color: var(--fp-ink-soft); border-bottom: 1px solid var(--fp-line); padding-bottom: 9px; }
.fp-ledger-head span:not(:first-child) { text-align: right; }
.fp-ledger-label { font-size: 13px; color: var(--fp-ink-soft); }
.fp-num { font-family: var(--fp-font-mono); font-size: 13px; text-align: right; }
.fp-ledger-total { border-top: 1px solid var(--fp-line); margin-top: 2px; padding-top: 10px; }
.fp-ledger-total .fp-ledger-label { font-weight: 600; color: var(--fp-ink); }
.fp-ledger-total .fp-num { font-weight: 600; font-size: 14px; }
.fp-balance { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--fp-line); font-size: 13px; color: var(--fp-ink-soft); }
.fp-balance strong { color: var(--fp-ink); }
.fp-debe { margin-top: 6px; font-size: 13.5px; font-weight: 600; color: var(--fp-teal); }
.fp-debe strong { color: var(--fp-teal); }
.fp-acumulado-debe { margin-top: 4px; font-size: 12.5px; font-weight: 600; color: var(--fp-teal); }

.fp-stat-col { display: flex; flex-direction: column; gap: 10px; }
.fp-stat {
  background: var(--fp-teal-soft);
  border-radius: 6px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fp-teal);
}
.fp-stat-pending { background: var(--fp-gold-soft); color: var(--fp-gold); }
.fp-stat-value { font-family: var(--fp-font-mono); font-size: 15px; font-weight: 600; color: var(--fp-ink); }
.fp-stat-label { font-size: 11.5px; color: var(--fp-ink-soft); margin-top: 1px; }

.fp-acumulado {
  margin-top: 14px;
  background: var(--fp-gold-soft);
  border: 1px solid var(--fp-line);
  border-radius: 8px;
  padding: 14px 16px;
}
.fp-acumulado-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  cursor: pointer; flex-wrap: wrap;
}
.fp-acumulado-label { font-size: 12px; color: var(--fp-ink-soft); }
.fp-acumulado-value { font-family: var(--fp-font-mono); font-size: 15px; font-weight: 600; margin-top: 2px; color: var(--fp-ink); }
.fp-acumulado-toggle {
  font-family: var(--fp-font-body); font-size: 12px; font-weight: 600;
  background: none; border: 1px solid var(--fp-line); border-radius: 20px;
  padding: 6px 12px; color: var(--fp-ink); cursor: pointer; white-space: nowrap;
}
.fp-historial-list { margin-top: 14px; border-top: 1px solid var(--fp-line); padding-top: 10px; }
.fp-historial-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 6px 0; font-size: 12.5px; }
.fp-historial-head { color: var(--fp-ink-soft); font-weight: 600; font-size: 11.5px; }
.fp-historial-row .fp-num { text-align: right; }

.fp-chart { margin-top: 26px; }
.fp-chart h2, .fp-list-header h2 {
  font-family: var(--fp-font-display);
  font-weight: 600;
  font-size: 18px;
  margin: 0 0 12px;
}

.fp-list-header { margin-top: 30px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.fp-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fp-btn-add {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--fp-font-body); font-weight: 600; font-size: 13px;
  background: var(--fp-ink); color: var(--fp-paper);
  border: none; border-radius: 5px; padding: 7px 12px; cursor: pointer;
}

.fp-list { margin-top: 14px; display: flex; flex-direction: column; }
.fp-empty { padding: 24px 0; text-align: center; color: var(--fp-ink-soft); font-size: 13px; }

.fp-row {
  display: grid;
  grid-template-columns: 26px 1fr auto auto 26px;
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid var(--fp-line);
}
.fp-row-pending { opacity: 0.85; }
.fp-row-icon { color: var(--fp-ink-soft); display: flex; justify-content: center; }
.fp-row-desc { font-size: 14px; font-weight: 500; }
.fp-row-meta { font-size: 11.5px; color: var(--fp-ink-soft); margin-top: 2px; }
.fp-row-amount { font-family: var(--fp-font-mono); font-size: 13.5px; white-space: nowrap; }
.fp-row-del { background: none; border: none; color: var(--fp-ink-soft); cursor: pointer; display: flex; justify-content: center; }
.fp-row-del:hover { color: var(--fp-rust); }

.fp-status-pill {
  font-family: var(--fp-font-body); font-size: 11px; font-weight: 600;
  border-radius: 20px; padding: 4px 10px; border: none; cursor: pointer; white-space: nowrap;
}
.fp-status-pagado { background: var(--fp-teal-soft); color: var(--fp-teal); }
.fp-status-pendiente { background: var(--fp-gold-soft); color: var(--fp-gold); }
.fp-status-aporte { background: var(--fp-rust-soft); color: var(--fp-rust); cursor: default; }

.fp-modal-overlay {
  position: fixed; inset: 0; background: rgba(35,43,36,0.4);
  display: flex; align-items: flex-end; justify-content: center; z-index: 50;
  padding: 0;
}
@media (min-width: 560px) { .fp-modal-overlay { align-items: center; padding: 20px; } }

.fp-modal {
  background: var(--fp-paper);
  width: 100%; max-width: 440px;
  max-height: 92vh; overflow-y: auto;
  border-radius: 12px 12px 0 0;
  padding: 20px 20px 26px;
  display: flex; flex-direction: column; gap: 14px;
}
@media (min-width: 560px) { .fp-modal { border-radius: 10px; } }

.fp-modal-head { display: flex; align-items: center; justify-content: space-between; }
.fp-modal-head h3 { font-family: var(--fp-font-display); font-size: 19px; margin: 0; font-weight: 600; }
.fp-icon-btn { background: none; border: none; color: var(--fp-ink-soft); cursor: pointer; padding: 2px; }

.fp-kind-toggle, .fp-who-toggle {
  display: flex; gap: 6px; background: var(--fp-paper-raised);
  border: 1px solid var(--fp-line); border-radius: 6px; padding: 3px;
}
.fp-who-toggle { flex-wrap: wrap; }
.fp-kind-toggle button, .fp-who-toggle button {
  flex: 1; min-width: 70px;
  font-family: var(--fp-font-body); font-size: 12.5px; font-weight: 600;
  background: none; border: none; border-radius: 4px; padding: 8px 6px;
  color: var(--fp-ink-soft); cursor: pointer;
}
.fp-kind-toggle button.active, .fp-who-toggle button.active {
  background: var(--fp-ink); color: var(--fp-paper);
}

.fp-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--fp-ink-soft); font-weight: 500; }
.fp-field input, .fp-field select {
  font-family: var(--fp-font-body); font-size: 14px; color: var(--fp-ink);
  border: 1px solid var(--fp-line); border-radius: 5px; padding: 9px 10px;
  background: var(--fp-paper-raised);
}
.fp-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.fp-btn-submit {
  margin-top: 4px;
  font-family: var(--fp-font-body); font-weight: 700; font-size: 14px;
  background: var(--fp-teal); color: #fff;
  border: none; border-radius: 6px; padding: 12px; cursor: pointer;
}

.fp-pending-note { font-size: 12.5px; color: var(--fp-ink-soft); margin: -4px 0 0; line-height: 1.5; }
.fp-assign-summary { font-size: 14px; color: var(--fp-ink-soft); margin: -4px 0 4px; }
.fp-who-toggle-assign button { padding: 12px 6px; font-size: 13px; }
`;
