// Wrapper SweetAlert2 bertema Design System (audit UX: konfirmasi & selesai).
// Ganti popup default browser (window.confirm) dengan modal yang menyatu
// dengan tampilan aplikasi — tombol memakai kelas .button, ikon memakai
// token warna DS, font mengikuti aplikasi (dioverride di style.css).
import Swal from 'sweetalert2'

const THEME = {
  buttonsStyling: false,
  customClass: {
    popup: 'swal-popup',
    title: 'swal-title',
    htmlContainer: 'swal-text',
    icon: 'swal-icon',
    confirmButton: 'button button-primary swal-button',
    cancelButton: 'button button-secondary swal-button',
    denyButton: 'button button-danger swal-button',
    timerProgressBar: 'swal-timer-bar',
  },
  reverseButtons: true,
}

/**
 * Modal konfirmasi sebelum aksi penting.
 * @returns {Promise<boolean>} true bila pengguna menekan tombol konfirmasi.
 */
export function confirmAction({
  title,
  text,
  confirmText = 'Ya, lanjutkan',
  cancelText = 'Batal',
  icon = 'warning',
  danger = false,
} = {}) {
  return Swal.fire({
    ...THEME,
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    ...(danger ? { customClass: { ...THEME.customClass, confirmButton: 'button button-danger swal-button' } } : {}),
  }).then((result) => result.isConfirmed)
}

/**
 * Dialog sukses yang menutup sendiri (varian Auto-Close Alert Dialog).
 * @returns {Promise<void>}
 */
export function successDialog({ title = 'Berhasil', text = '', timer = 2000 } = {}) {
  return Swal.fire({
    ...THEME,
    title,
    text,
    icon: 'success',
    showConfirmButton: false,
    showCancelButton: false,
    timer,
    timerProgressBar: true,
  })
}

/**
 * Dialog informasi dengan tombol OK (varian Success Alert Modal).
 * @returns {Promise<void>}
 */
export function infoDialog({ title, text, confirmText = 'OK', icon = 'success' } = {}) {
  return Swal.fire({
    ...THEME,
    title,
    text,
    icon,
    confirmButtonText: confirmText,
  })
}

/**
 * Dialog detail konten (mis. rincian tanggal kalender) dengan isi HTML.
 * Tanpa ikon besar — judul + baris detail, satu tombol tutup.
 * @returns {Promise<void>}
 */
export function detailDialog({ title, html, confirmText = 'Tutup', icon } = {}) {
  return Swal.fire({
    ...THEME,
    title,
    html,
    confirmButtonText: confirmText,
    ...(icon ? { icon } : {}),
  })
}

export { Swal }
