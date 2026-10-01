export default function ReceiverLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`html,body{overflow:hidden;background:#000;cursor:none}`}</style>
      {children}
    </>
  );
}
