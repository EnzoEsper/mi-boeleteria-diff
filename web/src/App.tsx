import { BrowserRouter } from 'react-router-dom'
import { createApi } from './api'
import { Shell } from './Shell'

const api = createApi()

function App() {
  return (
    <div className="app">
      <header className="cabecera">
        <h1>mi-boleteria diff</h1>
        <p>Historial de cambios del JSON de horarios</p>
      </header>
      <main>
        <BrowserRouter>
          <Shell api={api} />
        </BrowserRouter>
      </main>
    </div>
  )
}

export default App
