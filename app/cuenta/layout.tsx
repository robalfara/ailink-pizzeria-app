import Footer from "../components/Footer";
import Navbar from "../components/Navbar";

/**
 * Layout del área de cliente.
 *
 * Aquí NO se comprueba la sesión. Con Partial Rendering los layouts no se
 * vuelven a renderizar al navegar entre rutas hijas, así que un check puesto
 * aquí daría una falsa sensación de seguridad. La comprobación vive en cada
 * page y en cada action, a través de la DAL.
 */
export default function CuentaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Navbar />
      <main className="bg-paper flex-1 px-6 py-12">
        <div className="mx-auto max-w-2xl">{children}</div>
      </main>
      <Footer />
    </>
  );
}
