import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, configured } from './supabase'

type Role = 'admin' | 'fisio' | 'recepcion'
type Profile = { id: string; full_name: string; role: Role }
type Patient = {
  id: string; file_no: number; first_name: string; last_name1: string; last_name2: string | null
  birth_date: string | null; phone: string | null; status: string
}
type Note = {
  id: string; session_no: number; status: 'draft' | 'final'; s: string; o: string; a: string; p: string
  eva: number | null; created_at: string; finalized_at: string | null; profiles?: { full_name: string } | null
}
type View = { name: 'list' } | { name: 'new' } | { name: 'patient'; id: string }

const STATUS: Record<string, string> = {
  primera_valoracion: 'Primera valoración', en_tratamiento: 'En tratamiento', en_seguimiento: 'En seguimiento',
  alta: 'Alta fisioterapéutica', suspendido: 'Tratamiento suspendido', abandono: 'Abandono del tratamiento',
}
const PATIENT_COLS = 'id,file_no,first_name,last_name1,last_name2,birth_date,phone,status'
const NOTE_COLS = 'id,session_no,status,s,o,a,p,eva,created_at,finalized_at,profiles(full_name)'
const SOAP = [
  ['s', 'Subjetivo', 'Cómo llega el paciente, cambios desde la sesión anterior, adherencia'],
  ['o', 'Objetivo', 'Hallazgos, rangos, fuerza, mediciones'],
  ['a', 'Análisis', 'Respuesta al tratamiento y evolución funcional'],
  ['p', 'Plan', 'Tratamiento aplicado, ejercicios domiciliarios, siguiente sesión'],
] as const

const fileNo = (n: number) => 'TF-' + String(n).padStart(5, '0')
const fmt = (d: string) => new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
const age = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  const t = new Date()
  let a = t.getFullYear() - y
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < dd)) a--
  return a + ' años'
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    addEventListener('online', up)
    addEventListener('offline', down)
    return () => { removeEventListener('online', up); removeEventListener('offline', down) }
  }, [])
  return on
}

function Shell({ online = true, children }: { online?: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      {!online && <div className="offline" role="alert">Sin conexión: no se pueden consultar ni guardar datos clínicos hasta recuperar internet.</div>}
      {children}
    </div>
  )
}

function Login({ online }: { online: boolean }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) setMsg('Correo o contraseña incorrectos.')
    setBusy(false)
  }
  async function recover() {
    if (!email) return setMsg('Escribe tu correo y toca de nuevo “Olvidé mi contraseña”.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
    setMsg(error ? 'No se pudo enviar el correo. Intenta de nuevo.' : 'Si el correo está registrado, recibirás un enlace para crear una contraseña nueva.')
  }
  return (
    <form className="card login" onSubmit={submit}>
      <div className="logo">T</div>
      <h1>TeraFi Clinic</h1>
      <label>Correo<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Contraseña<input type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} required /></label>
      {msg && <p className="note">{msg}</p>}
      <button className="primary" disabled={busy || !online}>Entrar</button>
      <button type="button" className="link" onClick={recover} disabled={!online}>Olvidé mi contraseña</button>
    </form>
  )
}

function NewPassword({ done }: { done: () => void }) {
  const [p, setP] = useState('')
  const [msg, setMsg] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (p.length < 10) return setMsg('Usa al menos 10 caracteres.')
    const { error } = await supabase.auth.updateUser({ password: p })
    if (error) setMsg('No se pudo cambiar la contraseña. Pide un enlace nuevo.')
    else done()
  }
  return (
    <form className="card login" onSubmit={save}>
      <h1>Contraseña nueva</h1>
      <label>Contraseña<input type="password" autoComplete="new-password" value={p} onChange={e => setP(e.target.value)} required /></label>
      {msg && <p className="note">{msg}</p>}
      <button className="primary">Guardar contraseña</button>
    </form>
  )
}

export default function App() {
  const online = useOnline()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [view, setView] = useState<View>({ name: 'list' })
  const uid = session?.user.id

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s)
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setProfile(undefined)
    setView({ name: 'list' })
    if (!uid) return
    supabase.from('profiles').select('id,full_name,role').eq('id', uid).maybeSingle()
      .then(({ data }) => setProfile((data as Profile | null) ?? null))
  }, [uid])

  // Cierre de sesión tras 15 minutos sin actividad
  useEffect(() => {
    if (!uid) return
    let t = 0
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => supabase.auth.signOut(), 15 * 60 * 1000) }
    const evs = ['pointerdown', 'keydown', 'touchstart']
    evs.forEach(e => addEventListener(e, reset))
    reset()
    return () => { clearTimeout(t); evs.forEach(e => removeEventListener(e, reset)) }
  }, [uid])

  if (!configured) return <Shell><p className="err">Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.</p></Shell>
  if (!ready) return <Shell online={online}><p className="muted">Cargando…</p></Shell>
  if (session && recovery) return <Shell online={online}><NewPassword done={() => setRecovery(false)} /></Shell>
  if (!session) return <Shell online={online}><Login online={online} /></Shell>
  if (profile === undefined) return <Shell online={online}><p className="muted">Cargando…</p></Shell>
  if (profile === null) {
    return (
      <Shell online={online}>
        <p>Tu cuenta aún no tiene un rol activo. Pide al administrador que la habilite.</p>
        <button onClick={() => supabase.auth.signOut()}>Salir</button>
      </Shell>
    )
  }
  return (
    <Shell online={online}>
      <header><h1>TeraFi Clinic</h1><small>Hola, {profile.full_name}</small></header>
      <main>
        {view.name === 'list' && <PatientList open={id => setView({ name: 'patient', id })} />}
        {view.name === 'new' && <NewPatient online={online} done={id => setView({ name: 'patient', id })} />}
        {view.name === 'patient' && <PatientView id={view.id} profile={profile} online={online} back={() => setView({ name: 'list' })} />}
      </main>
      <nav className="tabbar">
        <button onClick={() => setView({ name: 'list' })}>Pacientes</button>
        <button className="primary" onClick={() => setView({ name: 'new' })}>Nuevo paciente</button>
        <button onClick={() => supabase.auth.signOut()}>Salir</button>
      </nav>
    </Shell>
  )
}

function PatientList({ open }: { open: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<Patient[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      setLoading(true)
      let req = supabase.from('patients').select(PATIENT_COLS)
      const s = q.replace(/[,()%*"\\]/g, ' ').trim()
      for (const w of s.split(/\s+/).filter(Boolean)) {
        const f = ['first_name', 'last_name1', 'last_name2', 'phone'].map(c => `${c}.ilike.%${w}%`)
        const num = w.replace(/^tf-?/i, '')
        if (/^\d+$/.test(num)) f.push(`file_no.eq.${Number(num)}`)
        req = req.or(f.join(','))
      }
      if (status) req = req.eq('status', status)
      const { data, error } = await req.order('created_at', { ascending: false }).limit(50)
      if (!live) return
      if (error) setErr('No se pudo consultar. Revisa tu conexión.')
      else { setErr(''); setRows(data as unknown as Patient[]) }
      setLoading(false)
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q, status])

  return (
    <section>
      <input className="search" type="search" placeholder="Buscar por nombre, teléfono o expediente" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips">
        {[['', 'Todos'], ...Object.entries(STATUS)].map(([k, v]) => (
          <button key={k} className={'chip' + (status === k ? ' on' : '')} onClick={() => setStatus(k)}>{v}</button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      {!loading && !err && rows.length === 0 && <p className="muted">No hay pacientes con ese criterio. Toca “Nuevo paciente” para registrar uno.</p>}
      <ul className="list">
        {rows.map(p => (
          <li key={p.id}>
            <button className="row" onClick={() => open(p.id)}>
              <span className="avatar">{p.first_name[0]}</span>
              <span className="grow"><b>{p.first_name} {p.last_name1} {p.last_name2}</b><small>{fileNo(p.file_no)} {age(p.birth_date)}</small></span>
              <span className="badge">{STATUS[p.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const FIELDS: [string, string, string][] = [
  ['first_name', 'Nombre', 'text'], ['last_name1', 'Apellido paterno', 'text'], ['last_name2', 'Apellido materno', 'text'],
  ['birth_date', 'Fecha de nacimiento', 'date'], ['phone', 'Teléfono', 'tel'], ['email', 'Correo', 'email'],
  ['emergency_contact', 'Contacto de emergencia', 'text'], ['emergency_relation', 'Parentesco', 'text'],
]

function NewPatient({ online, done }: { online: boolean; done: (id: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({ sex: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }))
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const row: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(f)) row[k] = v.trim() || null
    const { data, error } = await supabase.from('patients').insert(row).select('id').single()
    setBusy(false)
    if (error || !data) setErr('No se guardó el paciente. Revisa los datos y la conexión.')
    else done(data.id as string)
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>Nuevo paciente</h2>
      {FIELDS.map(([k, t, type]) => (
        <label key={k}>{t}
          <input type={type} value={f[k] ?? ''} required={k === 'first_name' || k === 'last_name1'} onChange={e => set(k, e.target.value)} />
        </label>
      ))}
      <label>Sexo
        <select value={f.sex} onChange={e => set('sex', e.target.value)}>
          <option value="">Sin indicar</option>
          <option value="femenino">Femenino</option>
          <option value="masculino">Masculino</option>
          <option value="otro">Otro</option>
        </select>
      </label>
      {err && <p className="err">{err}</p>}
      <button className="primary" disabled={busy || !online}>Guardar paciente</button>
    </form>
  )
}

function PatientView({ id, profile, online, back }: { id: string; profile: Profile; online: boolean; back: () => void }) {
  const clinical = profile.role !== 'recepcion'
  const [p, setP] = useState<Patient | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [edit, setEdit] = useState<Note | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const a = await supabase.from('patients').select(PATIENT_COLS).eq('id', id).single()
    if (a.error) return setErr('No se pudo abrir el expediente.')
    setP(a.data as unknown as Patient)
    if (clinical) {
      const b = await supabase.from('evolution_notes').select(NOTE_COLS).eq('patient_id', id).order('session_no', { ascending: false })
      setNotes((b.data ?? []) as unknown as Note[])
    }
  }
  useEffect(() => { load() }, [id])

  async function newNote() {
    const { data, error } = await supabase.from('evolution_notes').insert({ patient_id: id }).select(NOTE_COLS).single()
    if (error || !data) return alert('No se pudo crear la nota. Revisa tu conexión.')
    setEdit(data as unknown as Note)
  }

  if (edit) return <NoteEditor key={edit.id} note={edit} online={online} close={() => { setEdit(null); load() }} />
  if (err) return <p className="err">{err}</p>
  if (!p) return <p className="muted">Cargando…</p>
  return (
    <section className="card">
      <button className="link" onClick={back}>‹ Pacientes</button>
      <h2>{p.first_name} {p.last_name1} {p.last_name2}</h2>
      <small>{fileNo(p.file_no)} {age(p.birth_date)} {p.phone}</small>
      <span className="badge">{STATUS[p.status]}</span>
      {clinical && (
        <>
          <div className="bar"><h3>Evolución SOAP</h3><button className="primary" disabled={!online} onClick={newNote}>Nueva nota</button></div>
          {notes.length === 0 && <p className="muted">Aún no hay sesiones registradas.</p>}
          {notes.map(n => (
            <button key={n.id} className="row" onClick={() => setEdit(n)}>
              <span className="grow"><b>Sesión {n.session_no}</b><small>{fmt(n.created_at)} {n.profiles?.full_name}</small></span>
              <span className={'badge ' + n.status}>{n.status === 'final' ? 'Finalizada' : 'Borrador'}</span>
            </button>
          ))}
        </>
      )}
    </section>
  )
}

function NoteEditor({ note, online, close }: { note: Note; online: boolean; close: () => void }) {
  const locked = note.status === 'final'
  const [v, setV] = useState({ s: note.s, o: note.o, a: note.a, p: note.p, eva: note.eva === null ? '' : String(note.eva) })
  const [st, setSt] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [at, setAt] = useState<Date | null>(null)
  const latest = useRef(v)
  latest.current = v
  const first = useRef(true)

  // Solo se marca "Guardado" cuando la base confirmó la fila actualizada
  async function save(final = false) {
    const x = latest.current
    setSt('saving')
    const patch: Record<string, unknown> = { s: x.s, o: x.o, a: x.a, p: x.p, eva: x.eva === '' ? null : Number(x.eva) }
    if (final) patch.status = 'final'
    const { data, error } = await supabase.from('evolution_notes').update(patch).eq('id', note.id).select('id')
    if (error || !data || data.length === 0) { setSt('error'); return false }
    if (latest.current === x) { setSt('saved'); setAt(new Date()) }
    return true
  }

  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (locked) return
    setSt('dirty')
    const t = setTimeout(() => { if (navigator.onLine) save(); else setSt('error') }, 1500)
    return () => clearTimeout(t)
  }, [v])

  async function leave() {
    if (!locked && st !== 'saved') {
      const ok = await save()
      if (!ok && !confirm('No se pudo guardar. ¿Salir y perder los últimos cambios?')) return
    }
    close()
  }
  async function finalize() {
    if (!confirm('Al finalizar, la nota ya no se podrá editar; solo se podrán agregar adendas. ¿Finalizar?')) return
    if (await save(true)) close()
  }
  async function remove() {
    if (!confirm('¿Eliminar este borrador?')) return
    const { data, error } = await supabase.from('evolution_notes').delete().eq('id', note.id).select('id')
    if (error || !data || data.length === 0) alert('No se pudo eliminar el borrador.')
    else close()
  }

  const label = locked ? 'Finalizada' + (note.finalized_at ? ' ' + fmt(note.finalized_at) : '')
    : st === 'saving' ? 'Guardando…'
    : st === 'saved' ? (at ? 'Guardado ' + at.toLocaleTimeString('es-MX', { timeStyle: 'short' }) : 'Borrador')
    : st === 'dirty' ? 'Cambios sin guardar' : 'No se pudo guardar'

  return (
    <section className="card">
      <div className="bar"><button className="link" onClick={leave}>‹ Volver</button><b>Sesión {note.session_no}</b></div>
      <span className={'save ' + st}>{label}</span>
      {SOAP.map(([k, t, h]) => (
        <label key={k}>{t}
          <textarea rows={4} placeholder={h} readOnly={locked} value={v[k]} onChange={e => { const x = e.target.value; setV(s => ({ ...s, [k]: x })) }} />
        </label>
      ))}
      <label>EVA (0 a 10)
        <input type="number" min={0} max={10} inputMode="numeric" readOnly={locked} value={v.eva} onChange={e => { const x = e.target.value; setV(s => ({ ...s, eva: x })) }} />
      </label>
      {locked ? <Addenda noteId={note.id} online={online} /> : (
        <>
          <button disabled={!online || st === 'saving'} onClick={() => save()}>Guardar borrador</button>
          <button className="primary" disabled={!online || st === 'saving'} onClick={finalize}>Finalizar nota</button>
          <button className="link" onClick={remove}>Eliminar borrador</button>
        </>
      )}
    </section>
  )
}

function Addenda({ noteId, online }: { noteId: string; online: boolean }) {
  const [list, setList] = useState<any[]>([])
  const [reason, setReason] = useState('')
  const [body, setBody] = useState('')
  const load = () => supabase.from('note_addenda').select('id,reason,body,created_at,profiles(full_name)')
    .eq('note_id', noteId).order('created_at').then(({ data }) => setList(data ?? []))
  useEffect(() => { load() }, [noteId])
  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('note_addenda').insert({ note_id: noteId, reason: reason.trim(), body: body.trim() })
    if (error) return alert('No se guardó la adenda.')
    setReason(''); setBody(''); load()
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h3>Adendas</h3>
      {list.length === 0 && <p className="muted">Esta nota no tiene correcciones.</p>}
      {list.map(a => (
        <div className="addendum" key={a.id}><small>{fmt(a.created_at)} {a.profiles?.full_name}</small><b>{a.reason}</b><span>{a.body}</span></div>
      ))}
      <form onSubmit={add} style={{ display: 'grid', gap: 12 }}>
        <input placeholder="Motivo de la corrección" value={reason} onChange={e => setReason(e.target.value)} required />
        <textarea rows={3} placeholder="Texto de la adenda" value={body} onChange={e => setBody(e.target.value)} required />
        <button className="primary" disabled={!online}>Agregar adenda</button>
      </form>
    </div>
  )
}
