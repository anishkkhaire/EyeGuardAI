from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import numpy as np
from keras.models import load_model
from keras.preprocessing import image
from datetime import datetime
from fpdf import FPDF

# Initialize Flask App
app = Flask(__name__)
CORS(app)

# Uploads folder
app.config['UPLOAD_FOLDER'] = 'uploads'
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Load AI Model
model = load_model('eyeguardai_model.h5')
class_labels = ['Mild', 'Moderate', 'No_DR', 'Proliferate_DR', 'Severe']

# Expanded Suggestions Dictionary
suggestions = {
    'No_DR': {
        'advice': "Your eye health is good. However, regular monitoring is crucial to prevent diabetic retinopathy.",
        'treatment': "No immediate treatment needed. Focus on prevention through lifestyle changes.",
        'food': "Eat fiber-rich foods, leafy greens, nuts, whole grains, and lean protein.",
        'avoid': "Limit processed foods, excessive carbs, high sugar intake, and fried foods.",
        'exercise': "Engage in daily physical activity like walking, yoga, or swimming.",
        'visit': "Routine eye check-up once a year."
    },
    'Mild': {
        'advice': "Early-stage diabetic retinopathy detected. Managing blood sugar is essential.",
        'treatment': "No medical treatment needed yet. Lifestyle adjustments are highly recommended.",
        'food': "Oats, spinach, turmeric, carrots, nuts, seeds, whole grains, and lean proteins.",
        'avoid': "Sugary drinks, refined carbs, excessive sodium, and processed foods.",
        'exercise': "At least 30 minutes of brisk walking or cycling daily.",
        'visit': "Visit an ophthalmologist every 6 months."
    },
    'Moderate': {
        'advice': "Your condition requires close monitoring to prevent further progression.",
        'treatment': "Possible need for medications. Consult an ophthalmologist.",
        'food': "Antioxidant-rich foods like berries, green tea, flaxseeds, and bitter gourd.",
        'avoid': "Strictly avoid processed foods, alcohol, and refined sugars.",
        'exercise': "Mild to moderate exercise; avoid heavy lifting or high-impact workouts.",
        'visit': "Eye specialist visit every 3 months."
    },
    'Proliferate_DR': {
        'advice': "Critical condition. Immediate treatment is necessary to prevent blindness.",
        'treatment': "Laser therapy or anti-VEGF injections may be required.",
        'food': "Vitamin A, C, and E-rich foods like citrus fruits, carrots, and almonds.",
        'avoid': "High-glycemic foods, sugary drinks, excessive carbs.",
        'exercise': "Low-intensity activities; avoid anything that increases eye pressure.",
        'visit': "URGENT: Visit an eye specialist immediately."
    },
    'Severe': {
        'advice': "Severe condition detected. High risk of permanent vision loss.",
        'treatment': "Immediate medical intervention, possible surgery, or laser therapy required.",
        'food': "Strict diabetic diet: high-fiber foods, lean protein, nuts, seeds.",
        'avoid': "No sugar, alcohol, high-fat foods, excessive sodium.",
        'exercise': "Doctor-supervised exercises only.",
        'visit': "URGENT: See a specialist immediately."
    }
}


# ---------------------- PREDICTION ROUTE ----------------------
@app.route('/predict', methods=['POST'])
def predict():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'})
    
    # Save uploaded image
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    # Image preprocessing
    img = image.load_img(filepath, target_size=(300, 300))
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)

    # Predict class
    prediction = model.predict(img_array)
    predicted_class = class_labels[np.argmax(prediction)]

    # Timestamp
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # PDF Report Path
    pdf_filename = f'{filename}_report.pdf'
    pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)

    # Generate PDF Report
    generate_pdf_report(filename, predicted_class, timestamp, pdf_path)

    # Return JSON response
    return jsonify({
        'result': predicted_class,
        'filename': filename,
        'timestamp': timestamp,
        'pdf_report': f'/download_report/{pdf_filename}',
        'advice': suggestions[predicted_class]['advice'],
        'food': suggestions[predicted_class]['food'],
        'exercise': suggestions[predicted_class]['exercise'],
        'avoid': suggestions[predicted_class]['avoid'],
        'visit': suggestions[predicted_class]['visit'],
        'treatment': suggestions[predicted_class]['treatment']
    })


# ---------------------- DOWNLOAD PDF ROUTE ----------------------
@app.route('/download_report/<pdf_file>')
def download_report(pdf_file):
    return send_file(os.path.join(app.config['UPLOAD_FOLDER'], pdf_file), as_attachment=True)


# ---------------------- GENERATE PDF REPORT ----------------------
def generate_pdf_report(filename, prediction, timestamp, path):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)

    # Title
    pdf.set_text_color(0, 0, 128)
    pdf.cell(200, 10, txt="EyeGuard AI - Diabetic Retinopathy Report", ln=True, align='C')
    pdf.ln(10)

    # Timestamp
    pdf.set_text_color(0, 0, 0)
    pdf.cell(200, 10, txt=f"Date & Time: {timestamp}", ln=True)
    pdf.ln(10)

    # Image
    try:
        image_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        pdf.image(image_path, x=20, w=50)
        pdf.ln(10)
    except Exception as e:
        print("Could not add image to PDF:", e)

    # Diagnosis
    pdf.set_font("Arial", style='B', size=12)
    pdf.cell(200, 10, txt=f"Diagnosis: {prediction}", ln=True)
    pdf.ln(5)

    # Detailed Report Sections
    sections = ["advice", "treatment", "food", "avoid", "exercise", "visit"]
    section_titles = {
        "advice": "Medical Advice",
        "treatment": "Suggested Treatment",
        "food": "Recommended Foods",
        "avoid": "Foods to Avoid",
        "exercise": "Exercise Recommendations",
        "visit": "Doctor Visit Recommendation"
    }

    for section in sections:
        pdf.set_font("Arial", style='B', size=12)
        pdf.cell(200, 10, txt=section_titles[section] + ":", ln=True)
        pdf.set_font("Arial", size=12)
        pdf.multi_cell(0, 8, txt=f"{suggestions[prediction][section]}")
        pdf.ln(5)

    # Footer
    pdf.set_font("Arial", style='I', size=10)
    pdf.cell(200, 10, txt="This report is generated by EyeGuard AI. Consult a doctor for medical advice.", ln=True, align='C')

    # Save PDF
    pdf.output(path)


# ---------------------- MAIN ----------------------
if __name__ == '__main__':
    app.run(port=5000, debug=True)