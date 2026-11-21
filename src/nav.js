// Sumber tunggal menu modul cuti. Sidebar desktop dan drawer mobile membaca daftar yang sama.
import {
  Ban, CalendarDays, ChartColumn, History, Inbox, LayoutDashboard, Plus,
  QrCode, ShieldCheck, Users, UsersRound, Wallet,
} from 'lucide-vue-next'

const staffItems = (queueLabel) => [
  { view: 'queue', text: queueLabel, icon: Inbox },
  { view: 'history', text: 'Pembatalan Cuti', icon: Ban, cancellationOnly: true },
  { view: 'calendar', text: 'Kalender Kerja', icon: CalendarDays },
  { view: 'reports', text: 'Laporan Cuti', icon: ChartColumn, adminOnly: true },
  { view: 'audit', text: 'Audit Log', icon: ShieldCheck, adminOnly: true },
  { view: 'directory', text: 'Pegawai & Cuti', icon: Users },
  { view: 'admin-master', text: 'Kelola data', icon: ShieldCheck, adminOnly: true, group: 'settings' },
  { view: 'teams', text: 'Tim kerja', icon: UsersRound, adminOnly: true, group: 'settings' },
  { view: 'verify', text: 'Verifikasi QR', icon: QrCode, adminOnly: true, group: 'settings' },
]

const employeeItems = [
  { view: 'dashboard', text: 'Dashboard Cuti', icon: LayoutDashboard },
  { view: 'request-form', text: 'Ajukan Cuti', icon: Plus },
  { view: 'balance', text: 'Saldo & Rincian', icon: Wallet },
  { view: 'history', text: 'Riwayat Pengajuan', icon: History },
  { view: 'calendar', text: 'Kalender Kerja', icon: CalendarDays },
]

export function navItemsFor({ employeeView, isAdmin, queueLabel, hasEmployee = false }) {
  const items = employeeView ? employeeItems : staffItems(queueLabel)
  return items.filter(item =>
    (!item.adminOnly || isAdmin) && (hasEmployee || !item.cancellationOnly))
}
