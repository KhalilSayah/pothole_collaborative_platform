export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <span className="logo" style={{ fontSize: '.95rem' }}>
          <span className="mark" style={{ width: 24, height: 24, fontSize: 12 }}>◎</span>
          Route Tlemcen
        </span>
        <span className="grow" />
        <span>Données ouvertes · OpenStreetMap</span>
        <span>Aucune donnée personnelle collectée</span>
        <a href="#/admin" style={{ opacity: .6 }}>Gestion</a>
      </div>
    </footer>
  );
}
