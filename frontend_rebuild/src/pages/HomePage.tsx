import { Link } from 'react-router-dom'
import { ArrowRight, Leaf, Recycle, TrendingUp } from 'lucide-react'
import DarkModeToggle from '../components/DarkModeToggle'

const HomePage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-coffee-100 to-primary-100 dark:from-gray-900 dark:to-gray-800">
      <header className="site-header bg-white dark:bg-gray-900 shadow-lg border-b border-coffee-200 dark:border-gray-700 letran-nav-accent">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="letran-coffee-gradient rounded-full p-2 mr-3">
                <Leaf className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-espresso-900 dark:text-white">VermiLinks</h1>
              </div>
            </div>
            <div className="flex items-center space-x-6">
              <Link to="/dashboard" className="text-espresso-700 dark:text-gray-300 hover:text-letran-600 dark:hover:text-letran-400 transition-colors">
                Live Dashboard
              </Link>
              <Link to="/admin" className="text-espresso-700 dark:text-gray-300 hover:text-letran-600 dark:hover:text-letran-400 transition-colors">
                Admin
              </Link>
              <DarkModeToggle />
              <Link
                to="/dashboard"
                className="bg-[#c81e36] hover:bg-[#b2182e] text-white font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 transition-colors duration-200"
              >
                <ArrowRight className="h-4 w-4" />
                <span>Dashboard</span>
              </Link>
            </div>
          </div>
        </nav>
      </header>

      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-coffee-100 to-primary-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-700" />
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden">
          <div className="absolute top-20 right-20 w-32 h-32 bg-letran-200/30 dark:bg-letran-400/20 rounded-full blur-2xl" />
          <div className="absolute bottom-20 left-20 w-40 h-40 bg-coffee-200/30 dark:bg-coffee-400/20 rounded-full blur-2xl" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="mb-12">
              <div className="bg-gradient-to-br from-primary-600 to-letran-600 rounded-full p-6 w-24 h-24 mx-auto flex items-center justify-center shadow-lg hover:shadow-xl transition-all duration-300">
                <Leaf className="h-12 w-12 text-white" />
              </div>
            </div>

            <div className="mb-16">
              <h1 className="font-hero text-4xl md:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-espresso-900 via-coffee-700 to-letran-600 dark:from-white dark:via-gray-200 dark:to-letran-400 mb-6 leading-tight tracking-tight drop-shadow-sm">
                From Bean to Bin
              </h1>
              <div className="w-20 h-1.5 bg-gradient-to-r from-letran-500 via-coffee-500 to-primary-600 dark:from-letran-400 dark:via-coffee-400 dark:to-primary-500 rounded-full mx-auto mb-8 shadow-sm" />
              <h2 className="font-sans text-2xl md:text-3xl font-medium text-primary-600 dark:text-primary-400 mb-12 tracking-wide">
                Eco-Friendly Innovation
              </h2>
            </div>

            <div className="max-w-3xl mx-auto mb-16">
              <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-xl p-8 shadow-lg border border-gray-100 dark:border-gray-600 mb-10">
                <p className="font-elegant text-2xl md:text-3xl text-espresso-800 dark:text-gray-100 font-semibold mb-6 leading-relaxed italic text-center">
                  Brew better beginnings for the planet!
                </p>
                <p className="font-sans text-lg text-espresso-600 dark:text-gray-300 leading-relaxed mb-6">
                  Our web-based vermicompost system transforms used coffee grounds into nutrient-rich organic fertilizer—powered by
                  <span className="font-semibold text-letran-600 dark:text-letran-400"> African nightcrawlers</span> and
                  <span className="font-semibold text-primary-600 dark:text-primary-400"> IoT technology</span>.
                </p>
                <p className="font-sans text-base text-espresso-600 dark:text-gray-300 leading-relaxed">
                  Together, let's turn coffee grounds into growth with
                  <span className="font-semibold text-letran-600 dark:text-letran-400"> Letran's commitment to sustainability</span>.
                </p>
              </div>

              <div className="mb-12">
                <div className="text-center">
                  <div className="text-6xl text-letran-400/40 dark:text-letran-300/40 mb-4 font-serif leading-none">&quot;</div>
                  <p className="font-elegant text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-700 via-letran-600 to-coffee-700 dark:from-primary-400 dark:via-letran-400 dark:to-coffee-400 italic leading-relaxed tracking-wide drop-shadow-lg">
                    Your coffee's second life starts here.
                  </p>
                  <div className="text-6xl text-letran-400/40 dark:text-letran-300/40 mt-4 font-serif leading-none">&quot;</div>
                  <div className="w-32 h-1.5 bg-gradient-to-r from-letran-500 via-coffee-500 to-primary-600 dark:from-letran-400 dark:via-coffee-400 dark:to-primary-500 rounded-full mx-auto mt-6 shadow-lg" />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <Link
                to="/dashboard"
                className="font-sans bg-[#c81e36] hover:bg-[#b2182e] text-white font-semibold px-8 py-3 rounded-full shadow-lg flex items-center gap-3 transition-all duration-200 tracking-wide"
              >
                <ArrowRight className="h-5 w-5" />
                <span>Open Dashboard</span>
              </Link>
              <Link
                to="/dashboard"
                className="font-sans border border-letran-400 text-letran-600 hover:bg-letran-50 dark:text-letran-300 dark:border-letran-500 dark:hover:bg-gray-800 font-semibold px-8 py-3 rounded-full shadow flex items-center gap-3 transition-all duration-200"
              >
                <span>View Live Data</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-white via-coffee-100 to-primary-50 dark:from-gray-800 dark:via-gray-700 dark:to-gray-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 dark:via-gray-900/30 to-transparent" />
        <div className="absolute top-10 left-10 w-32 h-32 bg-letran-300/20 dark:bg-letran-400/30 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-coffee-300/20 dark:bg-coffee-400/30 rounded-full blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="font-hero text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-espresso-900 via-coffee-700 to-letran-600 dark:from-white dark:via-gray-200 dark:to-letran-400 mb-6 tracking-tight">
              Our <span className="font-black">Revolutionary</span> Features
            </h2>
            <div className="w-24 h-1.5 bg-gradient-to-r from-letran-500 via-coffee-500 to-primary-600 dark:from-letran-400 dark:via-coffee-400 dark:to-primary-500 rounded-full mx-auto mb-8" />
            <p className="font-sans text-lg md:text-xl text-espresso-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Experience the future of environmental monitoring with cutting-edge technology and sustainable innovation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
            <div className="group relative h-full feature-card" data-accent="green">
              <div className="relative p-8 shadow-2xl border border-white/10 dark:border-white/10 hover:shadow-3xl transition-all duration-500 group-hover:-translate-y-2 h-full flex flex-col min-h-[320px]">
                <div className="feature-card-inner text-center w-full">
                  <div className="feature-icon-badge bg-gradient-to-br from-success-100 to-success-200 dark:from-success-800 dark:to-success-700 mx-auto mb-4 flex items-center justify-center">
                    <Leaf className="h-7 w-7 text-success-600 dark:text-success-200" />
                  </div>
                  <div className="card-edge-glow" />
                  <h3 className="text-2xl font-bold text-espresso-900 dark:text-white mb-2 group-hover:text-letran-600 dark:group-hover:text-letran-400 transition-colors duration-300">
                    Eco-friendliness
                  </h3>
                  <div className="text-sm text-espresso-600 dark:text-gray-300 mb-4">Repurpose waste • Reduce landfill • Enrich soil</div>
                  <p className="text-espresso-600 dark:text-gray-300 leading-relaxed mb-4">
                    Repurpose coffee grounds to reduce waste and enrich soil across campus.
                  </p>
                  <div className="mt-3">
                    <span className="feature-cta" role="presentation" tabIndex={-1}>Campus Compost Initiative</span>
                  </div>
                </div>
                <div className="accent-corner" />
              </div>
            </div>

            <div className="group relative h-full feature-card" data-accent="red">
              <div className="relative p-8 shadow-2xl border border-white/10 dark:border-white/10 hover:shadow-3xl transition-all duration-500 group-hover:-translate-y-2 h-full flex flex-col min-h-[320px]">
                <div className="feature-card-inner text-center w-full">
                  <div className="feature-icon-badge bg-gradient-to-br from-letran-100 to-letran-200 dark:from-letran-800 dark:to-letran-700 mx-auto mb-4 flex items-center justify-center">
                    <TrendingUp className="h-7 w-7 text-letran-600 dark:text-letran-200" />
                  </div>
                  <div className="card-edge-glow" />
                  <h3 className="text-2xl font-bold text-espresso-900 dark:text-white mb-2 group-hover:text-letran-600 dark:group-hover:text-letran-400 transition-colors duration-300">
                    IoT Integration
                  </h3>
                  <div className="text-sm text-espresso-600 dark:text-gray-300 mb-4">Sensors • Automation • Insights</div>
                  <p className="text-espresso-600 dark:text-gray-300 leading-relaxed mb-4">
                    Real-time telemetry and automation keep the system healthy and efficient.
                  </p>
                  <div className="mt-3">
                    <span className="feature-cta" role="presentation" tabIndex={-1}>Smart Monitoring</span>
                  </div>
                </div>
                <div className="accent-corner" />
              </div>
            </div>

            <div className="group relative h-full feature-card" data-accent="orange">
              <div className="relative p-8 shadow-2xl border border-white/10 dark:border-white/10 hover:shadow-3xl transition-all duration-500 group-hover:-translate-y-2 h-full flex flex-col min-h-[320px]">
                <div className="feature-card-inner text-center w-full">
                  <div className="feature-icon-badge bg-gradient-to-br from-warning-100 to-warning-200 dark:from-warning-800 dark:to-warning-700 mx-auto mb-4 flex items-center justify-center">
                    <Recycle className="h-7 w-7 text-warning-600 dark:text-warning-200" />
                  </div>
                  <div className="card-edge-glow" />
                  <h3 className="text-2xl font-bold text-espresso-900 dark:text-white mb-2 group-hover:text-letran-600 dark:group-hover:text-letran-400 transition-colors duration-300">
                    Vermiculture
                  </h3>
                  <div className="text-sm text-espresso-600 dark:text-gray-300 mb-4">Nutrient rich • Sustainable • Local</div>
                  <p className="text-espresso-600 dark:text-gray-300 leading-relaxed mb-4">
                    Produce sustainable fertilizer from organic waste with consistent, automated care.
                  </p>
                  <div className="mt-3">
                    <span className="feature-cta" role="presentation" tabIndex={-1}>Closed-Loop Growth</span>
                  </div>
                </div>
                <div className="accent-corner" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default HomePage
