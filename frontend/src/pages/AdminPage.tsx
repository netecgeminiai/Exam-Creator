import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import AdminPanel from "../AdminPanel";

export default function AdminPage() {
  const navigate = useNavigate();
  const { questionNumber } = useParams<{ questionNumber?: string }>();
  const [searchParams] = useSearchParams();
  const examCode = searchParams.get("exam") ?? "MS-900";
  const focusQuestion = questionNumber ? parseInt(questionNumber) : null;

  const handleBack = () => {
    if (focusQuestion) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return <AdminPanel onBack={handleBack} focusQuestion={focusQuestion} examCode={examCode} />;
}
