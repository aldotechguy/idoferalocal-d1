import React, { useState } from 'react';
import { Receipt, Plus, Calendar, Search, Filter, X, Trash2 } from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { ExpenseCategory, Expense, PaymentMethod } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { ConfirmModal } from '../common/ConfirmModal';

export const ExpensesView: React.FC = () => {
  const { expenses, addExpense, deleteExpense, settings } = useApp();
  const { currentUser } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const todayForInput = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  };
  const [formData, setFormData] = useState({
    title: '',
    category: 'Rent' as ExpenseCategory,
    amount: 100,
    description: '',
    paymentMethod: 'Bank Transfer' as PaymentMethod,
    date: todayForInput(),
  });

  const categories: ExpenseCategory[] = [
    'Rent',
    'Salaries',
    'Electricity',
    'Fuel',
    'Marketing',
    'Repairs',
    'Lunch',
    'Logistics',
    'Miscellaneous',
  ];

  const filteredExpenses = expenses.filter(
    (e) => selectedCategory === 'All' || e.category === selectedCategory
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || formData.amount <= 0) return;

    addExpense({
      ...formData,
      paidBy: currentUser?.displayName || 'Accountant',
    });

    setShowAddModal(false);
    setFormData({
      title: '',
      category: 'Rent',
      amount: 100,
      description: '',
      paymentMethod: 'Bank Transfer',
      date: todayForInput(),
    });
  };

  const totalExpense = expenses.reduce((acc, e) => acc + e.amount, 0);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Expense Tracking
          </h1>
          <p className="text-xs text-slate-500">
            Log operational expenditure including rent, utilities, salaries, marketing, and meals.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Log Expense</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase">Total Logged Operational Expenditure</span>
          <p className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-0.5">{settings.currencySymbol}{totalExpense.toFixed(2)}</p>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-xs font-bold rounded-xl text-slate-800 dark:text-white border border-transparent"
          >
            <option value="All">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Amount</th>
                <th className="py-3 px-3">Payment Method</th>
                <th className="py-3 px-3">Paid By</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4">
                    <p className="font-bold text-slate-900 dark:text-white">{exp.title}</p>
                    {exp.description && <p className="text-[10px] text-slate-400">{exp.description}</p>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold text-[10px]">
                      {exp.category}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-extrabold text-rose-600 dark:text-rose-400">
                    -{settings.currencySymbol}{exp.amount.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-medium">{exp.paymentMethod}</td>
                  <td className="py-3 px-3 font-semibold">{exp.paidBy}</td>
                  <td className="py-3 px-4 font-mono text-slate-500">{exp.date}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setExpenseToDelete(exp)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Delete Expense Log"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Log New Expense</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Expense Title *</label>
                <input type="text" required value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Category</label>
                  <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value as any })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold">
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Amount ({settings.currencySymbol})</label>
                  <input type="number" step="0.01" min="0.01" required value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold" />
                </div>
              </div>
              <div>
                <label className="block font-bold mb-1">Expense Date *</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input type="date" required value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full pl-9 pr-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold" />
                </div>
              </div>
              <div>
                <label className="block font-bold mb-1">Payment Method</label>
                <select value={formData.paymentMethod} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as any })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">Description / Receipt Notes</label>
                <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 font-semibold">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-xs">Record Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Expense Confirmation Modal */}
      <ConfirmModal
        isOpen={!!expenseToDelete}
        title="Delete Expense Log"
        message={`Are you sure you want to delete the expense log "${expenseToDelete?.title}" for ${settings.currencySymbol}${expenseToDelete?.amount.toFixed(2)}?`}
        confirmText="Delete Expense"
        variant="danger"
        onClose={() => setExpenseToDelete(null)}
        onConfirm={() => {
          if (expenseToDelete) {
            deleteExpense(expenseToDelete.id);
            setExpenseToDelete(null);
          }
        }}
      />
    </div>
  );
};
