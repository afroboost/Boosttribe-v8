import { BrowserRouter, Routes, Route } from "react-router-dom";
import "@/styles/globals.css";
import Header from "@/components/layout/Header";
import HeroSection from "@/components/sections/HeroSection";

const HomePage = () => {
  return (
    <div 
      className="min-h-screen"
      style={{ 
        background: "#000000",
        color: "#FFFFFF",
      }}
    >
      <Header />
      <main>
        <HeroSection />
      </main>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
