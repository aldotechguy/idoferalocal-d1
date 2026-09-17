import React from 'react';

type FieldChild = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean };
export const FormField: React.FC<{ label: string; children: React.ReactElement<FieldChild>; error?: string; hint?: string; required?: boolean }> = ({ label, children, error, hint, required }) => {
  const generatedId = React.useId(); const id = children.props.id || generatedId; const helpId = `${id}-help`;
  return <div>
    <label htmlFor={id} className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">{label}{required && <span className="text-rose-500"> *</span>}</label>
    {React.cloneElement(children, { id, 'aria-describedby': error || hint ? helpId : undefined, 'aria-invalid': Boolean(error) })}
    {(error || hint) && <p id={helpId} className={`mt-1 text-xs ${error ? 'font-bold text-rose-600' : 'text-slate-500'}`} role={error ? 'alert' : undefined}>{error || hint}</p>}
  </div>;
};