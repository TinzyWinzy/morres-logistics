import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './operator/Dashboard';
import AdminDashboard from './operator/AdminDashboard';
import TrackDelivery from './customer/TrackDelivery';
import Navbar from './public/Navbar';
import Landing from './public/Landing';
import Offerings from './public/Offerings';
import Login from './public/Login';
import Footer from './public/Footer';
import './App.css'
import { useState, createContext, useEffect, useContext } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useContext(AuthContext);
  
  if (loading) {
    return <div className="d-flex justify-content-center p-5">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return children;
};

// Admin Route component
const AdminRoute = ({ children }) => {
  const { user, isAuthenticated, loading } = useContext(AuthContext);

  if (loading) {
    return <div className="d-flex justify-content-center p-5">Loading...</div>;
  }

  if (!isAuthenticated || user?.role !== 'admin') {
    return <Navigate to="/dashboard" />;
  }

  return children;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data } = await axios.get(`${import.meta.env.VITE_API_URL}/me`, {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        setUser(data);
      } catch (error) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    
    checkAuth();
  }, []);

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, setUser, isAuthenticated, loading }}>
      <Router>
        <Navbar />
        <Routes>
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/admin/dashboard" element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          } />
          <Route path="/track" element={<TrackDelivery />} />
          <Route path="/offerings" element={<Offerings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Landing />} />
        </Routes>
        <Footer />
      </Router>
    </AuthContext.Provider>
  );
}
